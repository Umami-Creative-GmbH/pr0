import { z } from "zod";

export const emailSchema = z.string().trim().max(254).email().toLowerCase();
export const credentialsSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(12).max(128),
});
export const emailRequestSchema = z.strictObject({ email: emailSchema });
export const emptyRequestSchema = z.strictObject({});
export const accountRequestSchema = z.union([
  credentialsSchema,
  emailRequestSchema,
  emptyRequestSchema,
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
  ]),
  retryAfter: z.number().int().positive().optional(),
});
export const verificationRequiredSchema = z.strictObject({
  status: z.literal("verification_required"),
});
export const successSchema = z.strictObject({ status: z.literal("ok") });
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
  prompts: z.array(z.never()),
});
export type PrivateLibrary = z.infer<typeof librarySchema>;
export type Credentials = z.infer<typeof credentialsSchema>;
export type AccountResponse =
  | z.infer<typeof accountErrorSchema>
  | z.infer<typeof verificationRequiredSchema>
  | z.infer<typeof successSchema>
  | PrivateLibrary
  | { status: "ready" | "unavailable" };
