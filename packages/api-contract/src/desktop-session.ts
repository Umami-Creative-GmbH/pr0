import { z } from "zod";

// Native command contracts; bearer credentials never enter renderer responses.
export const desktopStatusSchema = z.strictObject({
  state: z.enum([
    "signed_out",
    "awaiting_approval",
    "signed_in",
    "authentication_required",
    "cleanup_required",
    "synchronizing_sign_out",
  ]),
  generation: z.number().int().nonnegative(),
  origin: z.string().nullable(),
  email: z.string().nullable(),
  accountId: z.uuid().nullable(),
  instanceId: z.uuid().nullable(),
  userCode: z.string().nullable(),
  message: z.string(),
  pollAfterMs: z.number().nonnegative(),
});
export const signOutRequestSchema = z
  .strictObject({
    instanceId: z.uuid(),
    accountId: z.uuid(),
    generation: z.number().int().nonnegative(),
    choice: z.enum(["cancel", "synchronize", "discard", "retry_cleanup"]),
    discardConfirmed: z.boolean(),
  })
  .refine(
    (request) => request.choice !== "discard" || request.discardConfirmed,
    "Explicit discard confirmation is required"
  );
export type DesktopStatus = z.infer<typeof desktopStatusSchema>;
export type SignOutRequest = z.infer<typeof signOutRequestSchema>;
