import "server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/bun-sql";

import { assertRegistration } from "./admission";
import { account, session, user, verification } from "./auth-schema";
import { configuration } from "./config";
import { database } from "./database";
import { enqueueRecovery, enqueueVerification } from "./mail";
import { sessionAuthenticationVersion } from "./session-issuance";
import { socialAuthentication } from "./social-auth";

const createAuth = () => {
  const config = configuration();
  const schema = { account, session, user, verification };
  return betterAuth({
    baseURL: config.origin,
    secret: config.authSecret,
    trustedOrigins: [config.origin],
    plugins: [socialAuthentication()],
    onAPIError: { errorURL: `${config.origin}/?social=invalid` },
    database: drizzleAdapter(drizzle({ client: database(), schema }), {
      provider: "pg",
      schema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: recipient, token }, request) => {
        // Recovery is available only through the verified account address.
        if (!recipient.emailVerified) {
          return;
        }
        const reservation = request?.headers.get("x-pr0-mail-reservation");
        if (!reservation) {
          throw new Error("Missing email admission");
        }
        await enqueueRecovery(
          recipient.email,
          token,
          reservation,
          recipient.id
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async (
        { user: recipient, url, token },
        request
      ) => {
        const reservation = request?.headers.get("x-pr0-mail-reservation");
        if (!reservation) {
          throw new Error("Missing email admission");
        }
        await enqueueVerification(
          recipient.email,
          url,
          token,
          reservation,
          recipient.id,
          Boolean(
            request && new URL(request.url).pathname.endsWith("/sign-up/email")
          )
        );
      },
    },
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 0,
      cookieCache: { enabled: false },
      additionalFields: {
        provenance: { type: "string", defaultValue: "browser", input: false },
        authenticationVersion: {
          type: "number",
          defaultValue: 0,
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (value) => {
            await assertRegistration(value.email);
            return { data: value };
          },
        },
      },
      session: {
        create: {
          before: (value) =>
            Promise.resolve({
              data: {
                ...value,
                authenticationVersion: sessionAuthenticationVersion(),
              },
            }),
        },
      },
    },
    advanced: {
      useSecureCookies: config.secure,
      database: { generateId: () => crypto.randomUUID() },
      ipAddress: { disableIpTracking: true },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secure,
      },
    },
    // Admission is enforced durably on every exposed route, shared across processes.
    rateLimit: { enabled: false },
    logger: { disabled: true },
    telemetry: { enabled: false },
  });
};

let auth: ReturnType<typeof createAuth> | undefined;
export const authentication = () => {
  auth ??= createAuth();
  return auth;
};
