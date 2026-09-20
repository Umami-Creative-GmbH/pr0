import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import {
  accountIdentitySchema,
  linkMethodSchema,
  removeMethodSchema,
  loginMethodsSchema,
  reauthenticationSchema,
  emailChangeSchema,
  challengeVerificationSchema,
  accountSettingsSchema,
  accountChallengeSchema,
  freshAuthenticationSchema,
  emailChangedSchema,
  accountErrorSchema,
  credentialsSchema,
  emailRequestSchema,
  librarySchema,
  successSchema,
  verificationRequiredSchema,
  passwordResetSchema,
  recoveryRequestedSchema,
  revokeSessionSchema,
  sessionsSchema,
  socialProvidersSchema,
  socialRedirectSchema,
  socialSignInSchema,
  socialVerificationSchema,
} from "./accounts";

const jsonResponse = (schema: string, description: string) => ({
  description,
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
  },
});
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 429, 503].map((status) => [
    String(status),
    {
      ...jsonResponse(
        "AccountError",
        "Validated error; 429/503 include retry guidance when available."
      ),
      headers: {
        "Retry-After": {
          schema: { type: "integer" as const },
          description: "Seconds before retry",
        },
      },
    },
  ])
);
const post = (
  operationId: string,
  schema: string,
  response: string,
  status = "200",
  description = "",
  authenticated = false
) => ({
  post: {
    operationId,
    tags: ["Accounts"],
    security: authenticated ? [{ BrowserSession: [] }] : [],
    description: `Same-origin browser request. The Origin header must equal the configured canonical origin. JSON body maximum 4096 bytes; no content encoding. Unlisted Better Auth routes are disabled. ${description}`,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${schema}` },
        },
      },
    },
    responses: {
      [status]: jsonResponse(response, "Request completed"),
      ...errors,
    },
  },
});

export const accountPaths = {
  "/api/v1/account/methods": {
    get: {
      operationId: "getLoginMethods",
      tags: ["Accounts"],
      security: [{ BrowserSession: [] }],
      description:
        "Verified browser only. Lists owned login methods and current usability. Disabled providers do not count as usable. No provider tokens or passwords are returned.",
      responses: {
        "200": jsonResponse("LoginMethods", "Owned login methods"),
        ...errors,
      },
    },
  },
  "/api/v1/account/methods/link": post(
    "linkLoginMethod",
    "LinkMethod",
    "SocialRedirect",
    "200",
    "Requires the server-owned fresh browser proof. Starts explicit Google/GitHub linking with single-use state bound to the initiating instance, account, browser session and email version. The provider callback rechecks provenance, identity and freshness before committing. One identity per provider; owned identities cannot merge accounts. Provider email need not match or replace the verified account email. Cancellation/failure preserves all methods. Direct Better Auth link and unlink routes remain disabled.",
    true
  ),
  "/api/v1/account/methods/remove": post(
    "removeLoginMethod",
    "RemoveMethod",
    "AccountSuccess",
    "200",
    "Rechecks browser provenance, account/email version and fresh proof. Serializes removal under the account lock and refuses last_login_method unless another usable credential or enabled provider remains. In-flight issuance against removed credentials is invalidated. Existing sessions and immutable library ownership are retained.",
    true
  ),
  "/api/v1/account": {
    get: {
      operationId: "getAccountSettings",
      tags: ["Accounts"],
      security: [{ BrowserSession: [] }],
      description:
        "Verified browser session only. Returns current email/version, required reauthentication method, server-owned proof expiry, and latest old-address notification state. Sent means SMTP accepted, not confirmed inbox delivery. Failed is retained after mail-job cleanup. Device provenance is refused even in a browser cookie.",
      responses: {
        "200": jsonResponse("AccountSettings", "Current account settings"),
        ...errors,
      },
    },
  },
  "/api/v1/account/reauth/challenges": post(
    "requestReauthentication",
    "AccountIdentity",
    "AccountChallenge",
    "202",
    "Social-only accounts: queues an eight-digit code to the current verified address. Bound to instance/account/browser session/email version; five-minute expiry, three wrong attempts, keyed digest, atomic one-time consumption, resend invalidation and shared email limits. Password accounts must re-enter their password.",
    true
  ),
  "/api/v1/account/reauth/verify": post(
    "reauthenticate",
    "Reauthentication",
    "FreshAuthentication",
    "200",
    "Verifies current password or the browser-bound social-only code and creates a server-owned ten-minute proof. Expected account and email version must still match. Session renewal, generic OTP, provider callback and device approval do not create proofs.",
    true
  ),
  "/api/v1/account/email/challenges": post(
    "requestEmailChange",
    "EmailChange",
    "AccountChallenge",
    "202",
    "Requires fresh authentication; queues a five-minute code to the replacement address. Resend invalidates the preceding replacement challenge in this browser. The current email remains unchanged.",
    true
  ),
  "/api/v1/account/email/verify": post(
    "verifyEmailChange",
    "ChallengeVerification",
    "EmailChanged",
    "200",
    "Rechecks freshness, identity/version, browser provenance and the one-time replacement code. Atomically changes email and queues the mandatory old-address notice (five delivery attempts, maximum 24 hours). Invalidates all account proofs/challenges and outstanding recovery tokens. Failure leaves the old email intact; pending is not proof of delivery. Notification state remains visible in account settings.",
    true
  ),
  "/api/auth/providers": {
    get: {
      operationId: "getSocialProviders",
      tags: ["Accounts"],
      description:
        "Enabled providers for this instance. No credentials are returned. Disabled providers reject direct starts and callbacks.",
      responses: {
        "200": jsonResponse(
          "SocialProviders",
          "Available browser sign-in methods"
        ),
        ...errors,
      },
    },
  },
  "/api/auth/sign-in/social": post(
    "signInSocial",
    "SocialSignIn",
    "SocialRedirect",
    "200",
    "Starts browser OAuth with a signed browser state cookie, single-use state, PKCE, and a fixed per-instance callback. Google additionally uses a verified ID-token nonce. Caller-supplied callbacks, tokens, scopes, and linking fields are rejected."
  ),
  "/api/auth/callback/{provider}": {
    get: {
      operationId: "completeSocialCallback",
      tags: ["Accounts"],
      description:
        "Provider browser navigation; requires the initiating state cookie. Exchanges the authorization code and verifies provider identity. Returning providers retain their immutable account and verified recovery email. New accounts require registration admission and a usable verified email; matching emails never link accounts. Missing/unverified email redirects to /social-email with a signed pending cookie and no session. Responses use no-store and no-referrer.",
      parameters: [
        {
          in: "path",
          name: "provider",
          required: true,
          schema: { type: "string", enum: ["google", "github"] },
        },
        {
          in: "query",
          name: "state",
          schema: { type: "string", maxLength: 256 },
        },
        {
          in: "query",
          name: "code",
          schema: { type: "string", maxLength: 2048 },
        },
        {
          in: "query",
          name: "error",
          schema: { type: "string", maxLength: 256 },
        },
      ],
      responses: {
        "303": {
          description:
            "Fixed same-instance redirect to the library, email collection, or actionable sign-in error; successful login sets an HttpOnly browser session cookie.",
          headers: { Location: { schema: { type: "string", format: "uri" } } },
        },
        ...errors,
      },
    },
  },
  "/api/auth/social/email": post(
    "requestSocialEmail",
    "EmailRequest",
    "VerificationRequired",
    "202",
    "Requires the signed pending browser cookie. Enforces registration and shared email admission. Queues durable encrypted verification email; resending replaces the token without extending the one-hour pending identity expiry. The email link uses a fragment, and creates no account or session."
  ),
  "/api/auth/social/verify": post(
    "verifySocialEmail",
    "SocialVerification",
    "AccountSuccess",
    "200",
    "Requires both the email token and initiating pending browser cookie. Atomically consumes the token once, rechecks provider availability and registration, and issues a verified browser session. Existing email collisions return account_not_linked; no implicit linking or account merging. Invalid, expired, wrong-browser, or replayed proofs return invalid_social."
  ),
  "/api/auth/request-password-reset": post(
    "requestRecovery",
    "EmailRequest",
    "RecoveryRequested",
    "202",
    "Returns the same response for verified, unverified and unknown accounts. Only verified account emails receive a one-hour recovery link. Uses the shared destination/IP email limits; SMTP failure does not change credentials. Link tokens travel in the reset page fragment, not request URLs."
  ),
  "/api/auth/reset-password": post(
    "resetPassword",
    "PasswordReset",
    "AccountSuccess",
    "200",
    "Consumes an unexpired token once, sets or replaces the password and revokes every previous session atomically. Invalid, expired or replayed tokens return invalid_recovery without changing credentials. Does not sign in automatically."
  ),
  "/api/v1/sessions": {
    get: {
      operationId: "getSessions",
      tags: ["Accounts"],
      security: [{ BrowserSession: [] }],
      description:
        "List active sessions for the verified account, using public session IDs, never credentials. Revalidates and renews the initiating browser session.",
      responses: {
        "200": jsonResponse("Sessions", "Independent active sessions"),
        ...errors,
      },
    },
  },
  "/api/v1/sessions/revoke": post(
    "revokeSession",
    "RevokeSession",
    "AccountSuccess",
    "200",
    "Revokes only the selected public session ID belonging to the caller. Unknown and foreign IDs return not_found. Selecting the current session ends its access.",
    true
  ),
  "/api/v1/sessions/revoke-others": post(
    "revokeOtherSessions",
    "EmptyRequest",
    "AccountSuccess",
    "200",
    "Revokes all other sessions of this account and preserves the initiating session. Revalidates persisted expiry and revocation before changing sessions.",
    true
  ),
  "/api/auth/sign-up/email": post(
    "registerAccount",
    "Credentials",
    "VerificationRequired",
    "202"
  ),
  "/api/auth/sign-in/email": post(
    "signInAccount",
    "Credentials",
    "AccountSuccess"
  ),
  "/api/auth/send-verification-email": post(
    "resendVerification",
    "EmailRequest",
    "VerificationRequired",
    "202"
  ),
  "/api/auth/sign-out": post(
    "signOutAccount",
    "EmptyRequest",
    "AccountSuccess"
  ),
  "/api/auth/verify-email": {
    get: {
      operationId: "verifyEmail",
      tags: ["Accounts"],
      parameters: [
        {
          in: "query",
          name: "token",
          required: true,
          schema: { type: "string", maxLength: 2048 },
        },
      ],
      description:
        "Email link verification. Redirects to the canonical sign-in screen with a success or invalid-link message; never automatically signs in. Caller callback destinations are ignored.",
      responses: {
        "303": {
          description: "Return to sign-in",
          headers: { Location: { schema: { type: "string" } } },
        },
        ...errors,
      },
    },
  },
  "/api/v1/library": {
    get: {
      operationId: "getPrivateLibrary",
      tags: ["Accounts"],
      security: [{ BrowserSession: [] }],
      description:
        "Verified browser account's library boundary. Renews the persisted session to 30 days from this request and returns its renewed HttpOnly cookie. No prompt operations are exposed in this slice.",
      parameters: [
        {
          in: "query",
          name: "accountId",
          schema: { type: "string", format: "uuid" },
          description:
            "Optional expected account identity; a different identity is forbidden.",
        },
      ],
      responses: {
        "200": jsonResponse(
          "PrivateLibrary",
          "Own empty library, account, instance, and public session metadata"
        ),
        ...errors,
      },
    },
  },
  "/api/v1/ready": {
    get: {
      operationId: "getReadiness",
      tags: ["System"],
      responses: {
        "200": jsonResponse(
          "Readiness",
          "Account schema and recent mail worker heartbeat are available; SMTP acceptance is not inbox delivery."
        ),
        "503": jsonResponse(
          "Readiness",
          "Configuration, schema, database, or worker is unavailable"
        ),
      },
    },
  },
} satisfies OpenAPIV3_1.PathsObject;

const schemas = {
  LinkMethod: linkMethodSchema,
  RemoveMethod: removeMethodSchema,
  LoginMethods: loginMethodsSchema,
  AccountIdentity: accountIdentitySchema,
  Reauthentication: reauthenticationSchema,
  EmailChange: emailChangeSchema,
  ChallengeVerification: challengeVerificationSchema,
  AccountSettings: accountSettingsSchema,
  AccountChallenge: accountChallengeSchema,
  FreshAuthentication: freshAuthenticationSchema,
  EmailChanged: emailChangedSchema,
  SocialProviders: socialProvidersSchema,
  SocialRedirect: socialRedirectSchema,
  SocialSignIn: socialSignInSchema,
  SocialVerification: socialVerificationSchema,
  PasswordReset: passwordResetSchema,
  RecoveryRequested: recoveryRequestedSchema,
  RevokeSession: revokeSessionSchema,
  Sessions: sessionsSchema,
  Credentials: credentialsSchema,
  EmailRequest: emailRequestSchema,
  AccountError: accountErrorSchema,
  VerificationRequired: verificationRequiredSchema,
  AccountSuccess: successSchema,
  PrivateLibrary: librarySchema,
  EmptyRequest: z.strictObject({}),
  Readiness: z.strictObject({ status: z.enum(["ready", "unavailable"]) }),
};
export const accountSchemas = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema),
  ])
);
