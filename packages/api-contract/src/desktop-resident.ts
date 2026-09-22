import { z } from "zod";

// Native process lifetime only; no REST endpoint is added.
export const residentStatusSchema = z.strictObject({
  quitRequested: z.boolean(),
  closeNotice: z.boolean(),
  settings: z.boolean(),
  saving: z.number().int().nonnegative(),
  quitting: z.boolean(),
});
export const residentActionSchema = z.enum([
  "quit",
  "cancel_quit",
  "close",
  "cancel_close",
  "settings",
  "close_settings",
]);
export type ResidentStatus = z.infer<typeof residentStatusSchema>;
export type ResidentAction = z.infer<typeof residentActionSchema>;

export const startupStatusSchema = z.strictObject({
  state: z.enum(["enabled", "disabled", "disabled_by_windows", "unavailable"]),
  offer: z.boolean(),
});
export const startupActionSchema = z.enum([
  "enable",
  "disable",
  "dismiss_offer",
]);
export type StartupStatus = z.infer<typeof startupStatusSchema>;
export type StartupAction = z.infer<typeof startupActionSchema>;
