import { z } from "zod";

export const desktopCopySchema = z.strictObject({
  instanceId: z.uuid(),
  accountId: z.uuid(),
  generation: z.number().int().positive(),
  promptId: z.uuidv4(),
});
export const desktopCopyResultSchema = z.strictObject({
  origin: desktopCopySchema,
  usageSaved: z.boolean(),
});
export const desktopUsageStatusSchema = z.strictObject({
  waiting: z.number().int().nonnegative(),
  awaitingDownload: z.number().int().nonnegative(),
  memoryOnly: z.number().int().nonnegative(),
  error: z.string().nullable(),
  retryAfterMs: z.number().int().nonnegative(),
});
export type DesktopCopy = z.infer<typeof desktopCopySchema>;
export type DesktopUsageStatus = z.infer<typeof desktopUsageStatusSchema>;
