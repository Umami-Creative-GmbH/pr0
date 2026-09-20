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
