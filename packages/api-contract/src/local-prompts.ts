import { z } from "zod";

import {
  libraryScopeSchema,
  promptSchema,
  promptTextSchema,
  revisionSchema,
} from "./prompts";

export const localSaveSchema = z.strictObject({
  ...libraryScopeSchema.shape,
  generation: z.number().int().nonnegative(),
  operationId: z.uuidv4(),
  promptId: z.uuidv4(),
  expectedLocalRevision: revisionSchema.nullable(),
  desired: promptTextSchema,
});
export type LocalSave = z.infer<typeof localSaveSchema>;
export const localPromptSchema = z.strictObject({
  prompt: promptSchema,
  localRevision: revisionSchema,
  pending: z.boolean(),
});
export type LocalPrompt = z.infer<typeof localPromptSchema>;
export const uploadStatusSchema = z.strictObject({
  lastCheckedAt: z.iso.datetime().nullable(),
  waiting: z.number().int().nonnegative(),
  awaitingDownload: z.number().int().nonnegative(),
  error: z.string().nullable(),
  retryAfterMs: z.number().int().nonnegative(),
  errors: z
    .array(z.strictObject({ promptId: z.uuidv4(), code: z.string() }))
    .max(100),
  mappings: z
    .array(z.strictObject({ originalId: z.uuidv4(), copyId: z.uuidv4() }))
    .max(100),
});
export type UploadStatus = z.infer<typeof uploadStatusSchema>;
