import { z } from "zod";

import {
  deviceApprovalSchema,
  deviceCancelSchema,
  deviceClientSchema,
  deviceTokenRequestSchema,
} from "./device";

export const emailSchema = z.string().trim().max(254).email().toLowerCase();
export const credentialsSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(12).max(128),
});
export const emailRequestSchema = z.strictObject({ email: emailSchema });
export const emptyRequestSchema = z.strictObject({});
export const accountIdentitySchema = z.strictObject({
  accountId: z.uuid(),
  emailVersion: z.number().int().nonnegative(),
});
export const passwordReauthenticationSchema = accountIdentitySchema.extend({
  password: z.string().min(12).max(128),
});
export const challengeVerificationSchema = accountIdentitySchema.extend({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{8}$/u),
});
export const reauthenticationSchema = z.union([
  passwordReauthenticationSchema,
  challengeVerificationSchema,
]);
export const accountChallengeSchema = z.strictObject({
  challengeId: z.uuid(),
  expiresAt: z.iso.datetime(),
});
export const emailChangeSchema = accountIdentitySchema.extend({
  email: emailSchema,
});
export const notificationStateSchema = z.enum(["pending", "sent", "failed"]);
export const accountSettingsSchema = accountIdentitySchema.extend({
  email: emailSchema,
  reauthentication: z.enum(["password", "email"]),
  freshUntil: z.iso.datetime().nullable(),
  notification: notificationStateSchema.nullable(),
});
export const emailChangedSchema = z.strictObject({
  status: z.literal("email_changed"),
  notification: notificationStateSchema,
});
export type AccountIdentity = z.infer<typeof accountIdentitySchema>;
export type Reauthentication = z.infer<typeof reauthenticationSchema>;
export type EmailChange = z.infer<typeof emailChangeSchema>;
export type ChallengeVerification = z.infer<typeof challengeVerificationSchema>;
export type AccountSettings = z.infer<typeof accountSettingsSchema>;
export const freshAuthenticationSchema = z.strictObject({
  status: z.literal("fresh"),
  expiresAt: z.iso.datetime(),
});
export const socialProviderSchema = z.enum(["google", "github"]);
export type SocialProvider = z.infer<typeof socialProviderSchema>;
export const socialSignInSchema = z.strictObject({
  provider: socialProviderSchema,
});
export const linkMethodSchema = accountIdentitySchema.extend({
  provider: socialProviderSchema,
});
export type LinkMethod = z.infer<typeof linkMethodSchema>;
export const methodLinkResultSchema = z.enum([
  "linked",
  "invalid",
  "provider_owned",
  "method_already_linked",
  "fresh_auth_required",
  "account_changed",
  "unauthenticated",
]);
export const removeMethodSchema = accountIdentitySchema.extend({
  methodId: z.uuid(),
});
export type RemoveMethod = z.infer<typeof removeMethodSchema>;
export const loginMethodsSchema = z.strictObject({
  accountId: z.uuid(),
  methods: z.array(
    z.strictObject({
      id: z.uuid(),
      provider: z.enum(["credential", "google", "github"]),
      usable: z.boolean(),
    })
  ),
  providers: z.array(socialProviderSchema),
});
export const socialProvidersSchema = z.strictObject({
  providers: z.array(socialProviderSchema),
});
export const socialRedirectSchema = z.strictObject({
  url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ((url.hostname === "accounts.google.com" &&
        url.pathname === "/o/oauth2/v2/auth") ||
        (url.hostname === "github.com" &&
          url.pathname === "/login/oauth/authorize"))
    );
  }),
});
export const socialVerificationSchema = z.strictObject({
  token: z.string().min(32).max(128),
});
export const passwordResetSchema = z.strictObject({
  token: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(128),
});
export const revokeSessionSchema = z.strictObject({ sessionId: z.uuid() });
export const sessionsSchema = z.strictObject({
  sessions: z.array(
    z.strictObject({
      id: z.uuid(),
      current: z.boolean(),
      provenance: z.enum(["browser", "device"]),
      userAgent: z.string().nullable(),
      createdAt: z.iso.datetime(),
      lastActiveAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    })
  ),
});
export const accountRequestSchema = z.union([
  deviceApprovalSchema,
  deviceCancelSchema,
  deviceClientSchema,
  deviceTokenRequestSchema,
  linkMethodSchema,
  removeMethodSchema,
  emailChangeSchema,
  accountIdentitySchema,
  reauthenticationSchema,
  credentialsSchema,
  emailRequestSchema,
  emptyRequestSchema,
  passwordResetSchema,
  revokeSessionSchema,
  socialSignInSchema,
  socialVerificationSchema,
]);
export type AccountRequest = z.infer<typeof accountRequestSchema>;
export const accountErrorSchema = z.strictObject({
  code: z.enum([
    "invalid_input",
    "invalid_credentials",
    "unauthenticated",
    "email_unverified",
    "forbidden",
    "registration_closed",
    "rate_limited",
    "unavailable",
    "not_found",
    "invalid_verification",
    "invalid_recovery",
    "invalid_social",
    "account_not_linked",
    "account_changed",
    "fresh_auth_required",
    "invalid_challenge",
    "email_change_unavailable",
    "provider_owned",
    "last_login_method",
    "method_already_linked",
  ]),
  retryAfter: z.number().int().positive().optional(),
});
export const verificationRequiredSchema = z.strictObject({
  status: z.literal("verification_required"),
});
export const successSchema = z.strictObject({ status: z.literal("ok") });
export const recoveryRequestedSchema = z.strictObject({
  status: z.literal("recovery_requested"),
});
export type PasswordReset = z.infer<typeof passwordResetSchema>;
export const librarySchema = z.strictObject({
  instance: z.strictObject({ id: z.uuid(), origin: z.url() }),
  account: z.strictObject({
    id: z.uuid(),
    email: emailSchema,
    verified: z.literal(true),
  }),
  session: z.strictObject({
    id: z.uuid(),
    expiresAt: z.iso.datetime(),
    provenance: z.literal("browser"),
  }),
  revision: z.string().regex(/^\d+$/u),
  epoch: z.uuid(),
  prompts: z.array(z.never()),
});
export type PrivateLibrary = z.infer<typeof librarySchema>;
export type Credentials = z.infer<typeof credentialsSchema>;
export type AccountResponse =
  | z.infer<typeof loginMethodsSchema>
  | z.infer<typeof accountSettingsSchema>
  | z.infer<typeof emailChangedSchema>
  | z.infer<typeof accountChallengeSchema>
  | z.infer<typeof freshAuthenticationSchema>
  | z.infer<typeof accountErrorSchema>
  | z.infer<typeof verificationRequiredSchema>
  | z.infer<typeof successSchema>
  | z.infer<typeof recoveryRequestedSchema>
  | z.infer<typeof sessionsSchema>
  | PrivateLibrary
  | z.infer<typeof socialProvidersSchema>
  | z.infer<typeof socialRedirectSchema>
  | { status: "ready" | "unavailable" };
