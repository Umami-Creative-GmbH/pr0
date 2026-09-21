import { z } from "zod";

import {
  libraryScopeSchema,
  promptSchema,
  promptTextSchema,
  promptErrorSchema,
  revisionSchema,
  conflictNoticeSchema,
  adjustmentNoticeSchema,
} from "./prompts";

export const localConflictPageSchema = libraryScopeSchema.extend({
  notices: z
    .array(
      conflictNoticeSchema.extend({
        originalAvailable: z.boolean(),
        copyAvailable: z.boolean(),
      })
    )
    .max(100),
  nextOffset: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
});
export const localAdjustmentPageSchema = libraryScopeSchema.extend({
  notices: z.array(adjustmentNoticeSchema).max(100),
  nextOffset: z.number().int().nonnegative().nullable(),
});

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
export const lifecycleActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("favorite"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("archive"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("duplicate"), copyId: z.uuidv4() }),
  z.strictObject({ kind: z.literal("delete"), confirmed: z.literal(true) }),
]);
export const localLifecycleSchema = localSaveSchema
  .omit({ desired: true })
  .extend({
    expectedLocalRevision: revisionSchema,
    action: lifecycleActionSchema,
  });
export type LifecycleAction = z.infer<typeof lifecycleActionSchema>;
export type LocalLifecycle = z.infer<typeof localLifecycleSchema>;
export const lifecycleResultSchema = z.strictObject({
  promptId: z.uuidv4(),
  localRevision: revisionSchema,
});
export const localRecoverySchema = z
  .strictObject({
    ...libraryScopeSchema.shape,
    generation: z.number().int().nonnegative(),
    promptId: z.uuidv4(),
    action: z.enum(["retry", "discard"]),
    confirmed: z.boolean(),
  })
  .refine(
    (value) => value.action !== "discard" || value.confirmed,
    "Confirm discard first."
  );
export type LocalRecovery = z.infer<typeof localRecoverySchema>;
export const localViewSchema = z.enum([
  "all",
  "favorites",
  "archive",
  "recents",
]);
export type LocalView = z.infer<typeof localViewSchema>;
export const uploadStatusSchema = z.strictObject({
  attentionError: z.string().nullable().optional(),
  pending: z
    .array(
      z.strictObject({
        promptId: z.uuidv4(),
        title: z.string(),
        deleting: z.boolean(),
      })
    )
    .max(10_000),
  lastCheckedAt: z.iso.datetime().nullable(),
  waiting: z.number().int().nonnegative(),
  awaitingDownload: z.number().int().nonnegative(),
  error: z.string().nullable(),
  retryAfterMs: z.number().int().nonnegative(),
  errors: z
    .array(
      z.strictObject({
        promptId: z.uuidv4(),
        code: z.string(),
        failure: promptErrorSchema.nullable().optional(),
      })
    )
    .max(10_000),
  mappings: z
    .array(z.strictObject({ originalId: z.uuidv4(), copyId: z.uuidv4() }))
    .max(100),
});
export type UploadStatus = z.infer<typeof uploadStatusSchema>;
export const localConflictReviewSchema = z.strictObject({
  ...libraryScopeSchema.shape,
  generation: z.number().int().nonnegative(),
  noticeId: z.uuidv4(),
});
