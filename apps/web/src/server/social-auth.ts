import "server-only";
import {
  emailRequestSchema,
  emailSchema,
  socialProviderSchema,
  socialSignInSchema,
  socialVerificationSchema,
  linkMethodSchema,
  methodLinkResultSchema,
} from "@pr0/api-contract/accounts";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
  generateState,
  parseState,
  handleOAuthUserInfo,
  verifyProviderIdToken,
} from "better-auth/oauth2";
import { z } from "zod";

import { AccountFailureError, admit, assertRegistration } from "./admission";
import { configuration } from "./config";
import { database } from "./database";
import {
  beginMethodLink,
  finishMethodLink,
  linkStateSchema,
} from "./login-methods";
import { enqueueSocialVerification } from "./mail";
import { withSessionIssuance } from "./session-issuance";
import { socialProvider } from "./social-config";
import {
  consumePendingSocial,
  consumeSocialAttempt,
  createPendingSocial,
  invalidSocial,
  pendingSocial,
  reserveSocialAttempt,
  socialHash,
  socialToken,
  socialAccountOwner,
  accountEmailExists,
} from "./social-store";

type SocialContext = Parameters<typeof handleOAuthUserInfo>[0];
const callbackURI = (provider: string) =>
  `${configuration().origin}/api/auth/callback/${provider}`;
const pendingCookie = (ctx: SocialContext) =>
  ctx.context.createAuthCookie("social_pending", { maxAge: 3600 });
const readPendingCookie = async (ctx: SocialContext) => {
  const token = await ctx.getSignedCookie(
    pendingCookie(ctx).name,
    ctx.context.secret
  );
  if (!token) {
    throw invalidSocial();
  }
  return token;
};
const registration = async (email: string) => {
  try {
    await assertRegistration(email);
  } catch (error) {
    if (error instanceof AccountFailureError) {
      throw new APIError("FORBIDDEN", { code: error.code });
    }
    throw error;
  }
};

const admitSocialSignup = async (ctx: SocialContext) => {
  const ip = ctx.request?.headers.get("x-pr0-client-bucket");
  if (!ip) {
    throw invalidSocial();
  }
  try {
    await admit([{ key: `signup:${ip}`, max: 5, seconds: 3600 }]);
  } catch (error) {
    if (error instanceof AccountFailureError && error.code === "rate_limited") {
      const retryAfter = error.retryAfter ?? 3600;
      ctx.setHeader("Retry-After", String(retryAfter));
      throw new APIError("TOO_MANY_REQUESTS", {
        code: "rate_limited",
        retryAfter,
      });
    }
    throw error;
  }
};

const finishSocial = async (
  ctx: SocialContext,
  provider: string,
  subject: string,
  email: string
) => {
  const owner = await socialAccountOwner(provider, subject);
  if (owner && !owner.email_verified) {
    throw invalidSocial();
  }
  const accountEmail = owner ? emailSchema.parse(owner.email) : email;
  if (!owner) {
    if (await accountEmailExists(accountEmail)) {
      throw new APIError("BAD_REQUEST", { code: "account_not_linked" });
    }
    await admitSocialSignup(ctx);
    await registration(accountEmail);
  }
  const result = await withSessionIssuance(accountEmail, () =>
    handleOAuthUserInfo(ctx, {
      userInfo: {
        id: subject,
        email: accountEmail,
        emailVerified: true,
        name: accountEmail,
      },
      account: { providerId: provider, accountId: subject },
      overrideUserInfo: false,
    })
  );
  if (!result.data) {
    throw new APIError("BAD_REQUEST", {
      code:
        result.error === "account not linked"
          ? "account_not_linked"
          : "invalid_social",
    });
  }
  await setSessionCookie(ctx, result.data);
};

const providerIdentity = async (
  ctx: SocialContext,
  providerId: "google" | "github",
  state: Awaited<ReturnType<typeof parseState>>
) => {
  const provider = socialProvider(providerId);
  if (!provider) {
    throw invalidSocial();
  }
  if (state.provider !== providerId || !ctx.query?.state) {
    throw invalidSocial();
  }
  await consumeSocialAttempt(ctx.query.state);
  if (ctx.query.error || !ctx.query.code) {
    throw invalidSocial();
  }
  const tokens = await provider.validateAuthorizationCode({
    code: ctx.query.code,
    codeVerifier: state.codeVerifier,
    redirectURI: callbackURI(providerId),
  });
  if (!tokens) {
    throw invalidSocial();
  }
  if (
    provider.id === "google" &&
    (!tokens.idToken ||
      !state.idTokenNonce ||
      !(await verifyProviderIdToken(
        provider,
        tokens.idToken,
        state.idTokenNonce,
        ctx
      )))
  ) {
    throw invalidSocial();
  }
  const info = await provider.getUserInfo(tokens);
  if (!info) {
    throw invalidSocial();
  }
  const data: unknown = info.data;
  const subject =
    providerId === "google"
      ? z.object({ sub: z.string().min(1).max(255) }).parse(data).sub
      : String(
          z
            .object({
              id: z.union([
                z.string().min(1).max(255),
                z.number().int().positive(),
              ]),
            })
            .parse(data).id
        );
  return {
    subject,
    email: emailSchema.safeParse(info.user.email),
    verified: info.user.emailVerified === true,
  };
};

export const socialAuthentication = () => ({
  id: "pr0-social",
  endpoints: {
    linkSocial: createAuthEndpoint(
      "/social/link",
      { method: "POST", body: linkMethodSchema },
      async (ctx) => {
        const provider = socialProvider(ctx.body.provider);
        if (!provider) {
          throw new APIError("NOT_FOUND", { code: "not_found" });
        }
        let methodLink;
        try {
          methodLink = await beginMethodLink(ctx, ctx.body);
        } catch (error) {
          if (error instanceof AccountFailureError) {
            ctx.setStatus(
              z
                .union([z.literal(401), z.literal(403), z.literal(409)])
                .parse(error.status)
            );
            return ctx.json({ code: error.code });
          }
          throw error;
        }
        const idTokenNonce = crypto.randomUUID();
        const { state, codeVerifier } = await generateState(ctx, {
          idTokenNonce,
          additionalData: { provider: provider.id, methodLink },
        });
        await reserveSocialAttempt(state);
        const url = await provider.createAuthorizationURL({
          state,
          codeVerifier,
          redirectURI: callbackURI(provider.id),
        });
        if (provider.id === "google") {
          url.searchParams.set("nonce", idTokenNonce);
        }
        return ctx.json({ url: url.toString() });
      }
    ),
    startSocial: createAuthEndpoint(
      "/social/start",
      {
        method: "POST",
        body: socialSignInSchema,
      },
      async (ctx) => {
        const provider = socialProvider(ctx.body.provider);
        if (!provider) {
          throw new APIError("NOT_FOUND", { code: "not_found" });
        }
        const idTokenNonce = crypto.randomUUID();
        const { state, codeVerifier } = await generateState(ctx, {
          idTokenNonce,
          additionalData: { provider: provider.id },
        });
        await reserveSocialAttempt(state);
        const url = await provider.createAuthorizationURL({
          state,
          codeVerifier,
          redirectURI: `${configuration().origin}/api/auth/callback/${provider.id}`,
        });
        if (provider.id === "google") {
          url.searchParams.set("nonce", idTokenNonce);
        }
        return ctx.json({ url: url.toString() });
      }
    ),
    callbackSocial: createAuthEndpoint(
      "/social/callback/:provider",
      {
        method: "GET",
        query: z.object({
          state: z.string().max(256).optional(),
          code: z.string().max(2048).optional(),
          error: z.string().max(256).optional(),
        }),
      },
      async (ctx) => {
        let destination = "/";
        let linking = false;
        try {
          const provider = socialProviderSchema.parse(ctx.params.provider);
          const state = await parseState(ctx);
          linking = state.methodLink !== undefined;
          const identity = await providerIdentity(ctx, provider, state);
          if (linking) {
            await finishMethodLink(
              ctx,
              linkStateSchema.parse(state.methodLink),
              provider,
              identity.subject
            );
            ctx.setStatus(303);
            ctx.setHeader(
              "Location",
              `${configuration().origin}/?methods=linked`
            );
            return ctx.json({ status: "ok" });
          }
          const owner = await socialAccountOwner(provider, identity.subject);
          if (
            owner?.email_verified ||
            (identity.email.success && identity.verified)
          ) {
            await finishSocial(
              ctx,
              provider,
              identity.subject,
              owner?.email ??
                (identity.email.success ? identity.email.data : "")
            );
          } else {
            const token = await createPendingSocial(provider, identity.subject);
            const cookie = pendingCookie(ctx);
            await ctx.setSignedCookie(
              cookie.name,
              token,
              ctx.context.secret,
              cookie.attributes
            );
            destination = "/social-email";
          }
        } catch (error) {
          let code: string | undefined;
          if (error instanceof AccountFailureError) {
            ({ code } = error);
          }
          if (error instanceof APIError) {
            code = error.body?.code;
          }
          destination = `/?social=${code === "account_not_linked" || code === "registration_closed" ? code : "invalid"}`;
          if (code === "rate_limited") {
            destination = "/?social=rate_limited";
          }
          if (linking) {
            const reason =
              methodLinkResultSchema.safeParse(code).data ?? "invalid";
            destination = `/?methods=${reason}`;
          }
        }
        ctx.setStatus(303);
        ctx.setHeader("Location", `${configuration().origin}${destination}`);
        return ctx.json({ status: "ok" });
      }
    ),
    requestSocialEmail: createAuthEndpoint(
      "/social/email",
      {
        method: "POST",
        body: emailRequestSchema,
      },
      async (ctx) => {
        const browserToken = await readPendingCookie(ctx);
        const pending = await pendingSocial(browserToken);
        if (!socialProvider(pending.provider)) {
          throw invalidSocial();
        }
        // Existing addresses may verify the collision and receive recovery guidance
        // even when new-account registration is closed.
        if (!(await accountEmailExists(ctx.body.email))) {
          await registration(ctx.body.email);
        }
        const reservation = ctx.request?.headers.get("x-pr0-mail-reservation");
        if (!reservation) {
          throw invalidSocial();
        }
        const token = socialToken();
        const sql = database();
        await sql`UPDATE social_pending SET email = ${ctx.body.email}, token_hash = ${socialHash(token)}
        WHERE id_hash = ${socialHash(browserToken)} AND expires_at > now()`;
        await enqueueSocialVerification(
          ctx.body.email,
          token,
          pending.expires_at,
          reservation
        );
        ctx.setStatus(202);
        return ctx.json({ status: "verification_required" });
      }
    ),
    verifySocialEmail: createAuthEndpoint(
      "/social/verify",
      {
        method: "POST",
        body: socialVerificationSchema,
      },
      async (ctx) => {
        const browserToken = await readPendingCookie(ctx);
        const pending = await pendingSocial(browserToken);
        if (!socialProvider(pending.provider)) {
          throw invalidSocial();
        }
        const verified = await consumePendingSocial(
          browserToken,
          ctx.body.token
        );
        await finishSocial(
          ctx,
          verified.provider,
          verified.subject,
          verified.email
        );
        const cookie = pendingCookie(ctx);
        ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
        return ctx.json({ status: "ok" });
      }
    ),
  },
});
