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
