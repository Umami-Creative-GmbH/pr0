import { z } from "zod";

export const promptLimits = {
  title: 200,
  description: 2000,
  contentBytes: 262_144,
  libraryBytes: 104_857_600,
  promptCount: 10_000,
  collectionCount: 200,
  tagCount: 1000,
  tagsPerPrompt: 20,
  organizationName: 60,
  warningRatio: 0.9,
} as const;
// Unicode White_Space (stable since Unicode 6.3); deliberately excludes BOM.
const outerWhitespace =
  // oxlint-disable-next-line eslint/no-control-regex -- This is the pinned Unicode White_Space set, including whitespace control characters.
  /^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/gu;
export const trimPromptText = (value: string) =>
  value.replace(outerWhitespace, "");
export const utf8Bytes = (value: string) =>
  new TextEncoder().encode(value).byteLength;
// oxlint-disable-next-line eslint/no-control-regex -- NUL and unpaired surrogates must be rejected before PostgreSQL storage.
const invalidScalar = /[\uD800-\uDFFF\u0000]/u;
const scalarText = z
  .string()
  .refine(
    (value) => !invalidScalar.test(value),
    "Use valid Unicode text without NUL characters."
  );
export const promptTextSchema = z.strictObject({
  title: scalarText
    .refine((value) => trimPromptText(value).length > 0, "Enter a title.")
    .refine(
      (value) => [...trimPromptText(value)].length <= promptLimits.title,
      "Title must be at most 200 Unicode code points."
    ),
  description: scalarText.refine(
    (value) => [...trimPromptText(value)].length <= promptLimits.description,
    "Description must be at most 2,000 Unicode code points."
  ),
  content: scalarText
    .refine(
      (value) => trimPromptText(value).length > 0,
      "Enter nonblank content."
    )
    .refine(
      (value) => utf8Bytes(value) <= promptLimits.contentBytes,
      "Content must be at most 256 KiB of UTF-8 text."
    ),
});
export type PromptText = z.infer<typeof promptTextSchema>;
export const conflictCopyTitle = (title: string) =>
  `${[...title].slice(0, promptLimits.title - 16).join("")} (conflict copy)`;
export const duplicatePromptTitle = (title: string) =>
  `${[...title].slice(0, promptLimits.title - 7).join("")} (copy)`;
export const revisionSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,18})$/u)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);
export const promptIdentitySchema = z.uuidv4();
export const sortedTagIds = (ids: string[]) => {
  const ordered = [...new Set(ids)];
  ordered.sort();
  return ordered;
};
export const libraryScopeSchema = z.strictObject({
  instanceId: z.uuid(),
  accountId: z.uuid(),
});
export type LibraryScope = z.infer<typeof libraryScopeSchema>;
export const promptSummarySchema = z.strictObject({
  id: promptIdentitySchema,
  title: z.string(),
  description: z.string(),
  revision: revisionSchema,
  createdAt: z.iso.datetime(),
  modifiedAt: z.iso.datetime(),
  favorite: z.boolean(),
  archived: z.boolean(),
  collectionId: promptIdentitySchema.nullable(),
  tagIds: z
    .array(promptIdentitySchema)
    .max(promptLimits.tagsPerPrompt)
    .default([]),
});
export const promptSchema = promptSummarySchema.extend({
  libraryRevision: revisionSchema.optional(),
  content: promptTextSchema.shape.content,
  ...libraryScopeSchema.shape,
  favorite: z.boolean(),
  archived: z.boolean(),
  useCount: z.number().int().nonnegative(),
  lastUsedAt: z.iso.datetime().nullable(),
  sourceTitle: z.string().nullable(),
});
export const conflictNoticeSchema = z.strictObject({
  id: promptIdentitySchema,
  originalId: promptIdentitySchema,
  originalDeleted: z.boolean(),
  copyId: promptIdentitySchema,
  sourceTitle: z.string(),
  createdAt: z.iso.datetime(),
  revision: revisionSchema,
});
export type ConflictNotice = z.infer<typeof conflictNoticeSchema>;
export const conflictPageSchema = z.strictObject({
  ...libraryScopeSchema.shape,
  notices: z.array(conflictNoticeSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const libraryUsageSchema = z.strictObject({
  promptCount: z.number().int().nonnegative(),
  textBytes: z.number().int().nonnegative(),
});
export const promptPageSchema = z.strictObject({
  ...libraryScopeSchema.shape,
  revision: revisionSchema,
  prompts: z.array(promptSummarySchema).max(100),
  nextCursor: z.string().nullable(),
  usage: libraryUsageSchema,
});
export const promptListInputSchema = z.strictObject({
  cursor: z.string().max(2048).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const promptViewSchema = z.enum(["all", "favorites", "archive"]);
export type PromptView = z.infer<typeof promptViewSchema>;
export const searchNormalizationVersion = "pr0-search-v1-ucd17";
export const promptQuerySchema = scalarText.refine(
  (value) => [...value].length <= 200,
  "Search must be at most 200 Unicode code points."
);
export const promptSortSchema = z.enum([
  "relevance",
  "recently-modified",
  "recently-used",
  "newest",
  "oldest",
  "title",
]);
export type PromptSort = z.infer<typeof promptSortSchema>;
export const promptBrowseInputSchema = promptListInputSchema.extend({
  query: promptQuerySchema.default(""),
  sort: promptSortSchema.optional(),
  view: promptViewSchema.default("all"),
  collectionId: promptIdentitySchema.optional(),
  tagIds: z.array(promptIdentitySchema).max(promptLimits.tagCount).optional(),
});
export const createPromptSchema = z.strictObject({
  operationId: promptIdentitySchema,
  kind: z.literal("prompt.create"),
  promptId: promptIdentitySchema,
  baseRevision: revisionSchema,
  dependsOn: z.array(promptIdentitySchema).max(100),
  desired: z.strictObject({
    title: z.string(),
    description: z.string(),
    content: z.string(),
    collectionId: promptIdentitySchema.nullable().optional(),
    tagIds: z
      .array(promptIdentitySchema)
      .max(promptLimits.tagsPerPrompt)
      .optional(),
  }),
});
export const createCollectionSchema = z.strictObject({
  operationId: promptIdentitySchema,
  kind: z.literal("collection.create"),
  collectionId: promptIdentitySchema,
  baseRevision: revisionSchema,
  dependsOn: z.array(promptIdentitySchema).max(100),
  name: z.string(),
});
export const renameCollectionSchema = createCollectionSchema.extend({
  kind: z.literal("collection.rename"),
});
export type CollectionOperation =
  | z.infer<typeof createCollectionSchema>
  | z.infer<typeof renameCollectionSchema>;
export const collectionSchema = z.strictObject({
  id: promptIdentitySchema,
  name: z.string(),
  revision: revisionSchema,
  activeCount: z.number().int().nonnegative(),
  archivedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
});
export type Collection = z.infer<typeof collectionSchema>;
export const createTagSchema = createCollectionSchema
  .omit({ collectionId: true })
  .extend({
    kind: z.literal("tag.create"),
    tagId: promptIdentitySchema,
  });
export const renameTagSchema = createTagSchema.extend({
  kind: z.literal("tag.rename"),
});
export type TagOperation =
  | z.infer<typeof createTagSchema>
  | z.infer<typeof renameTagSchema>;
export type Tag = z.infer<typeof collectionSchema>;
export const organizationStateSchema = z.strictObject({
  id: promptIdentitySchema,
  entity: z.enum(["collection", "tag"]),
  name: z.string(),
  state: z.enum(["deleted", "merged"]),
  targetId: promptIdentitySchema.nullable(),
  targetName: z.string().nullable(),
});
export const organizationSnapshotSchema = z.strictObject({
  ...libraryScopeSchema.shape,
  revision: revisionSchema,
  collections: z.array(collectionSchema).max(promptLimits.collectionCount),
  tags: z.array(collectionSchema).max(promptLimits.tagCount),
  textBytes: z.number().int().nonnegative(),
});
export const promptTextFields = ["title", "description", "content"] as const;
export const duplicatePromptSchema = createPromptSchema.extend({
  kind: z.literal("prompt.duplicate"),
  sourceId: promptIdentitySchema,
});
export type DuplicatePrompt = z.infer<typeof duplicatePromptSchema>;
export const promptStateFields = [
  "favorite",
  "archived",
  "collectionId",
] as const;
const editablePromptSchema = createPromptSchema.shape.desired
  .omit({ tagIds: true })
  .extend({
    favorite: z.boolean().optional(),
    archived: z.boolean().optional(),
  });
export const updatePromptSchema = createPromptSchema.extend({
  kind: z.literal("prompt.update"),
  base: editablePromptSchema,
  desired: editablePromptSchema,
  changedFields: z
    .array(z.enum([...promptTextFields, ...promptStateFields]))
    .max(6),
});
export type UpdatePrompt = z.infer<typeof updatePromptSchema>;
export const deletePromptSchema = createPromptSchema
  .omit({ desired: true })
  .extend({
    kind: z.literal("prompt.delete"),
  });
export type DeletePrompt = z.infer<typeof deletePromptSchema>;
export const assignTagsSchema = deletePromptSchema.extend({
  kind: z.literal("prompt.tags"),
  add: z.array(promptIdentitySchema).max(promptLimits.tagsPerPrompt),
  remove: z.array(promptIdentitySchema).max(promptLimits.tagsPerPrompt),
});
export type AssignTags = z.infer<typeof assignTagsSchema>;
export type Prompt = z.infer<typeof promptSchema>;
export const deleteCollectionSchema = createCollectionSchema
  .omit({ name: true })
  .extend({ kind: z.literal("collection.delete") });
export const deleteTagSchema = createTagSchema
  .omit({ name: true })
  .extend({ kind: z.literal("tag.delete") });
export const mergeTagSchema = deleteTagSchema.extend({
  kind: z.literal("tag.merge"),
  targetId: promptIdentitySchema,
});
export const organizationCleanupSchema = z.discriminatedUnion("kind", [
  deleteCollectionSchema,
  deleteTagSchema,
  mergeTagSchema,
]);
export type OrganizationCleanup = z.infer<typeof organizationCleanupSchema>;
export const organizationEffectSchema = z.strictObject({
  kind: z.enum(["collection.delete", "tag.delete", "tag.merge"]),
  sourceId: promptIdentitySchema,
  sourceName: z.string(),
  targetId: promptIdentitySchema.nullable(),
  targetName: z.string().nullable(),
  activeCount: z.number().int().min(0).max(promptLimits.promptCount),
  archivedCount: z.number().int().min(0).max(promptLimits.promptCount),
  targetActiveCount: z.number().int().min(0).max(promptLimits.promptCount),
  targetArchivedCount: z.number().int().min(0).max(promptLimits.promptCount),
});
export const organizationImpactInputSchema = z.strictObject({
  kind: z.enum(["collection.delete", "tag.delete", "tag.merge"]),
  sourceId: promptIdentitySchema,
  targetId: promptIdentitySchema.optional(),
});
export const organizationImpactSchema = z.strictObject({
  ...libraryScopeSchema.shape,
  revision: revisionSchema,
  effect: organizationEffectSchema,
});
export const organizationReviewSchema = z.strictObject({
  ...libraryScopeSchema.shape,
  operationId: promptIdentitySchema,
  effect: organizationEffectSchema,
  prompts: z
    .array(
      z.strictObject({
        id: promptIdentitySchema,
        originallyArchived: z.boolean(),
        current: promptSummarySchema.nullable(),
      })
    )
    .max(100),
  nextOffset: z.number().int().min(0).max(promptLimits.promptCount).nullable(),
});
export const organizationStatesSchema = z.strictObject({
  ...libraryScopeSchema.shape,
  states: z.array(organizationStateSchema).max(1000),
});
export const mutationEnvelopeSchema = z.strictObject({
  protocolVersion: z.literal(1),
  instanceId: z.uuid(),
  accountId: z.uuid(),
  epoch: z.uuid(),
  installationId: promptIdentitySchema,
  operations: z
    .array(
      z.discriminatedUnion("kind", [
        createPromptSchema,
        updatePromptSchema,
        duplicatePromptSchema,
        deletePromptSchema,
        createCollectionSchema,
        renameCollectionSchema,
        createTagSchema,
        renameTagSchema,
        assignTagsSchema,
        deleteCollectionSchema,
        deleteTagSchema,
        mergeTagSchema,
      ])
    )
    .min(1)
    .max(100)
    .refine(
      (operations) =>
        operations.length === 1 ||
        !operations.some(
          (operation) => organizationCleanupSchema.safeParse(operation).success
        ),
      "Organization cleanup must be a singleton request."
    ),
});
export type MutationEnvelope = z.infer<typeof mutationEnvelopeSchema>;
export type CreatePrompt = z.infer<typeof createPromptSchema>;
export const promptErrorSchema = z.strictObject({
  code: z.enum([
    "validation_failed",
    "name_conflict",
    "quota_exceeded",
    "operation_identity_reused",
    "identity_unavailable",
    "dependency_blocked",
    "authentication_required",
    "forbidden",
    "not_found",
    "update_required",
    "snapshot_required",
    "results_changed",
    "search_preparing",
    "rate_limited",
    "temporarily_unavailable",
  ]),
  message: z.string(),
  retryable: z.boolean(),
  operationId: promptIdentitySchema.optional(),
  retryAfter: z.number().int().positive().optional(),
  fields: z.record(z.string(), z.string()).optional(),
  resource: z
    .enum([
      "promptCount",
      "textBytes",
      "collectionCount",
      "tagCount",
      "tagsPerPrompt",
    ])
    .optional(),
  usage: libraryUsageSchema.optional(),
});
export type PromptError = z.infer<typeof promptErrorSchema>;
export const mutationReceiptSchema = z.strictObject({
  status: z.literal("accepted"),
  operationId: promptIdentitySchema,
  promptId: promptIdentitySchema,
  revision: revisionSchema,
  acceptedAt: z.iso.datetime(),
  organizationNotice: z.string().optional(),
  conflict: z
    .strictObject({
      copyId: promptIdentitySchema,
      noticeId: promptIdentitySchema,
    })
    .optional(),
});
export type MutationReceipt = z.infer<typeof mutationReceiptSchema>;
export const collectionReceiptSchema = mutationReceiptSchema
  .omit({ promptId: true, conflict: true, organizationNotice: true })
  .extend({ collectionId: promptIdentitySchema });
export const mutationResultSchema = z.union([
  mutationReceiptSchema
    .omit({ promptId: true, conflict: true, organizationNotice: true })
    .extend({ effect: organizationEffectSchema }),
  mutationReceiptSchema,
  collectionReceiptSchema,
  z.strictObject({
    status: z.literal("accepted"),
    operationId: promptIdentitySchema,
    tagId: promptIdentitySchema,
    resolvedTagId: promptIdentitySchema,
    outcome: z.enum(["created", "existing", "renamed"]),
    revision: revisionSchema,
    acceptedAt: z.iso.datetime(),
  }),
  z.strictObject({ status: z.literal("rejected"), error: promptErrorSchema }),
]);
export const mutationResponseSchema = z.strictObject({
  results: z.array(mutationResultSchema).min(1).max(100),
});
export type MutationResult = z.infer<typeof mutationResultSchema>;
