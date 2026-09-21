import { z } from "zod";

import {
  libraryScopeSchema,
  organizationEffectSchema,
  organizationSnapshotSchema,
  revisionSchema,
  searchNormalizationVersion,
} from "./prompts";
import { snapshotRecordsSchema } from "./snapshots";

export const changeLimits = {
  pageBytes: 4_194_304,
  events: 100,
  waitSeconds: 25,
} as const;
export const changeEventSchema = z.strictObject({
  revision: revisionSchema,
  operationId: z.uuidv4(),
  acceptedAt: z.iso.datetime(),
  prompts: snapshotRecordsSchema.shape.prompts.max(2),
  deletedPromptIds: z.array(z.uuidv4()).max(1),
  organization: organizationSnapshotSchema,
  effect: organizationEffectSchema.nullable(),
});
export const changeRequestSchema = z
  .strictObject({
    cursor: z.string().min(1).max(2048).optional(),
    after: revisionSchema.optional(),
    epoch: z.uuid().optional(),
    wait: z
      .number()
      .int()
      .min(0)
      .max(changeLimits.waitSeconds)
      .default(changeLimits.waitSeconds),
  })
  .refine(
    (value) =>
      (value.after === undefined) === (value.epoch === undefined) &&
      !(value.cursor && value.after !== undefined)
  );
export const changePageSchema = z
  .strictObject({
    ...libraryScopeSchema.shape,
    epoch: z.uuid(),
    version: z.literal(1),
    normalization: z.literal(searchNormalizationVersion),
    fromRevision: revisionSchema,
    revision: revisionSchema,
    headRevision: revisionSchema,
    cursor: z.string().min(1).max(2048),
    changes: z.array(changeEventSchema).max(changeLimits.events),
    hasMore: z.boolean(),
  })
  .superRefine((page, context) => {
    let revision = BigInt(page.fromRevision);
    let valid = true;
    for (const event of page.changes) {
      revision += 1n;
      valid &&=
        BigInt(event.revision) === revision &&
        event.organization.revision === event.revision;
      for (const record of [event.organization, ...event.prompts]) {
        valid &&=
          record.instanceId === page.instanceId &&
          record.accountId === page.accountId &&
          BigInt(record.revision) <= revision;
      }
      valid &&=
        new Set(event.prompts.map((prompt) => prompt.id)).size ===
        event.prompts.length;
      valid &&= !event.prompts.some((prompt) =>
        event.deletedPromptIds.includes(prompt.id)
      );
      valid &&= !event.effect || event.prompts.length === 0;
    }
    valid &&=
      revision === BigInt(page.revision) &&
      revision <= BigInt(page.headRevision) &&
      page.hasMore === revision < BigInt(page.headRevision);
    valid &&= !page.hasMore || page.changes.length > 0;
    if (!valid) {
      context.addIssue({
        code: "custom",
        message: "Incomplete or inconsistent change page",
      });
    }
  });
export type ChangePage = z.infer<typeof changePageSchema>;
export type ChangeRequest = z.input<typeof changeRequestSchema>;
export const changeStatusSchema = z.strictObject({
  error: z.string().nullable(),
  retryAfterMs: z.number().int().nonnegative(),
  updating: z.boolean(),
  lastCheckedAt: z.iso.datetime().nullable(),
});
export type ChangeStatus = z.infer<typeof changeStatusSchema>;
