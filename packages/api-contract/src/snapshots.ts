import { z } from "zod";

import {
  libraryScopeSchema,
  organizationSnapshotSchema,
  promptSchema,
  promptTextSchema,
  revisionSchema,
  utf8Bytes,
} from "./prompts";

export const snapshotLimits = {
  pageBytes: 4_194_304,
  manifestBytes: 262_144,
  pages: 1024,
  lifetimeMs: 900_000,
} as const;
export const snapshotManifestSchema = z.strictObject({
  ...libraryScopeSchema.shape,
  version: z.literal(1),
  normalization: z.literal("pr0-search-v1-ucd17"),
  id: z.uuidv4(),
  epoch: z.uuid(),
  revision: revisionSchema,
  expiresAt: z.iso.datetime(),
  promptCount: z.number().int().min(0).max(10_000),
  pages: z
    .array(
      z.strictObject({
        digest: z.string().regex(/^[a-f0-9]{64}$/u),
        bytes: z.number().int().positive().max(snapshotLimits.pageBytes),
      })
    )
    .min(1)
    .max(snapshotLimits.pages),
});
export type SnapshotManifest = z.infer<typeof snapshotManifestSchema>;
export const snapshotCreateRequestSchema = z.strictObject({
  minimumRevision: revisionSchema.optional(),
});
export const snapshotPageRequestSchema = z.strictObject({
  id: z.uuidv4(),
  page: z
    .number()
    .int()
    .min(0)
    .max(snapshotLimits.pages - 1),
});
export const snapshotPageSchema = z.strictObject({
  ...snapshotPageRequestSchema.shape,
  payload: z
    .string()
    .refine((value) => utf8Bytes(value) <= snapshotLimits.pageBytes),
});
export const snapshotRecordsSchema = z.strictObject({
  organization: organizationSnapshotSchema.nullable(),
  prompts: z
    .array(
      promptSchema.omit({ libraryRevision: true }).extend({
        title: promptTextSchema.shape.title,
        description: promptTextSchema.shape.description,
      })
    )
    .max(10_000),
});
export type SnapshotPage = z.infer<typeof snapshotPageSchema>;

// Native command responses, scoped to the retained account partition.
export const downloadStatusSchema = z.strictObject({
  recoveryError: z.string().nullable().optional(),
  ...libraryScopeSchema.shape,
  pendingChanges: z.number().int().nonnegative(),
  textBytes: z.number().int().nonnegative(),
  complete: z.boolean(),
  replacement: z.boolean(),
  catchingUp: z.boolean(),
  paused: z.boolean(),
  recoveryCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
  downloaded: z.number().int().nonnegative(),
  total: z.number().int().min(0).max(10_000),
  appliedPages: z.number().int().min(0).max(snapshotLimits.pages),
  totalPages: z.number().int().min(0).max(snapshotLimits.pages),
  revision: revisionSchema.nullable(),
});
export const recoverySummariesSchema = z
  .array(
    z.strictObject({
      snapshotId: z.uuidv4(),
      promptId: z.uuidv4(),
      title: z.string(),
      capturedAt: z.iso.datetime(),
    })
  )
  .max(50);
