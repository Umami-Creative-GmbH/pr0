// oxlint-disable react-doctor/server-sequential-independent-await -- Reads and writes depend on the same locked library transaction.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  mutationReceiptSchema,
  mutationResultSchema,
  collectionReceiptSchema,
  promptLimits,
  promptSchema,
  promptTextSchema,
  promptTextFields,
  promptStateFields,
  duplicatePromptTitle,
  conflictPageSchema,
  adjustmentPageSchema,
  trimPromptText,
  utf8Bytes,
  promptViewSchema,
  organizationEffectSchema,
} from "@pr0/api-contract/prompts";
import type {
  MutationEnvelope,
  CreatePrompt,
  DuplicatePrompt,
  UpdatePrompt,
  PromptText,
} from "@pr0/api-contract/prompts";
import type { TransactionSQL, SQL } from "bun";
import { z } from "zod";

import { AccountFailureError } from "./admission";
import { lockAccount } from "./browser-proof";
import type { BrowserAccount } from "./browser-proof";
import { captureChange } from "./change-record";
import {
  applyCollection,
  readOrganization,
  validateCollectionReference,
  reconcileCollectionAssignment,
} from "./collection-store";
import { configuration } from "./config";
import { reviewConflict } from "./conflict-review";
import { database } from "./database";
import { operationFingerprint } from "./operation-fingerprint";
import { applyOrganizationCleanup } from "./organization-cleanup";
import { prepareConflictCopy, persistConflictCopy } from "./prompt-conflict";
import {
  applyPromptDeletion,
  preserveDeletedPromptEdit,
} from "./prompt-deletion";
import {
  invalidPromptRequest,
  PromptFailureError,
  promptFailure,
} from "./prompt-errors";
import { applyPromptUse } from "./prompt-use";
import {
  initializePromptTags,
  applyTagAssignments,
  promptTagIds,
} from "./tag-membership";
import { applyTag } from "./tag-store";

interface LibraryRow {
  instance_id: string;
  recovery_epoch: string;
  revision: string;
  prompt_count: number;
  text_bytes: string;
}
export const lockLibrary = async (
  tx: TransactionSQL,
  browser: BrowserAccount
) => {
  const owner = await lockAccount(tx, browser);
  if (owner.suspended) {
    throw new AccountFailureError("account_suspended", 403);
  }
  const [library] = await tx<
    LibraryRow[]
  >`SELECT l.instance_id, i.recovery_epoch, l.revision::text, l.prompt_count, l.text_bytes::text
    FROM library l JOIN instance i ON i.id = l.instance_id WHERE l.account_id = ${browser.accountId} FOR UPDATE OF l`;
  if (!library) {
    throw new Error("Library unavailable");
  }
  return library;
};
const receiptColumns = z.object({
  organization_effect: organizationEffectSchema.nullable().optional(),
  operation_id: z.string(),
  prompt_id: z.string().nullable(),
  collection_id: z.string().nullable().optional(),
  tag_id: z.string().nullable().optional(),
  resolved_tag_id: z.string().nullable().optional(),
  tag_outcome: z.string().nullable().optional(),
  revision: z.string(),
  accepted_at: z.date(),
  used_at: z.date().nullable().optional(),
  organization_notice: z.string().nullable().optional(),
  conflict_copy_id: z.string().nullable().optional(),
  conflict_notice_id: z.string().nullable().optional(),
});
const receiptFrom = (row: z.infer<typeof receiptColumns>) => {
  if (row.organization_effect) {
    return mutationResultSchema.parse({
      status: "accepted",
      operationId: row.operation_id,
      revision: row.revision,
      acceptedAt: row.accepted_at.toISOString(),
      effect: row.organization_effect,
    });
  }
  if (row.tag_id) {
    return mutationResultSchema.parse({
      status: "accepted",
      operationId: row.operation_id,
      tagId: row.tag_id,
      resolvedTagId: row.resolved_tag_id,
      outcome: row.tag_outcome,
      revision: row.revision,
      acceptedAt: row.accepted_at.toISOString(),
    });
  }
  return row.collection_id
    ? collectionReceiptSchema.parse({
        status: "accepted",
        operationId: row.operation_id,
        collectionId: row.collection_id,
        revision: row.revision,
        acceptedAt: row.accepted_at.toISOString(),
      })
    : mutationReceiptSchema.parse({
        status: "accepted",
        operationId: row.operation_id,
        promptId: row.prompt_id,
        revision: row.revision,
        acceptedAt: row.accepted_at.toISOString(),
        organizationNotice: row.organization_notice ?? undefined,
        usedAt: row.used_at?.toISOString(),
        conflict: row.conflict_copy_id
          ? {
              copyId: row.conflict_copy_id,
              noticeId: row.conflict_notice_id,
            }
          : undefined,
      });
};
const validatedUpdateFields = (
  operation: UpdatePrompt,
  desired: PromptText
) => {
  const base = {
    title: trimPromptText(operation.base.title),
    description: trimPromptText(operation.base.description),
    content: operation.base.content,
  };
  const changedFields = new Set(operation.changedFields);
  if (
    !promptTextSchema.safeParse(base).success ||
    new Set(operation.changedFields).size !== operation.changedFields.length ||
    promptStateFields.some(
      (field) =>
        (operation.base[field] === undefined) !==
          (operation.desired[field] === undefined) ||
        (operation.base[field] !== operation.desired[field]) !==
          changedFields.has(field)
    ) ||
    promptTextFields.some(
      (field) => (base[field] !== desired[field]) !== changedFields.has(field)
    )
  ) {
    throw invalidPromptRequest();
  }
  return { base, changedFields };
};
const applyPromptUpdate = async ({
  savepoint,
  browser,
  library,
  envelope,
  operation,
  desired,
  hash,
}: {
  savepoint: SQL;
  browser: BrowserAccount;
  library: LibraryRow;
  envelope: MutationEnvelope;
  operation: UpdatePrompt;
  desired: PromptText;
  hash: string;
}) => {
  const { base, changedFields } = validatedUpdateFields(operation, desired);
  const [current] =
    await savepoint`SELECT title, description, content, favorite, archived, collection_id, collection_revision::text, revision::text, title_revision::text, description_revision::text, content_revision::text FROM prompt
        WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND id = ${operation.promptId}`;
  if (!current) {
    return preserveDeletedPromptEdit(
      { sql: savepoint, envelope, operation, hash },
      desired
    );
  }
  const next = {
    title: current.title,
    description: current.description,
    content: current.content,
  };
  let conflict = false;
  for (const field of promptTextFields.filter((entry) =>
    changedFields.has(entry)
  )) {
    if (current[field] === desired[field]) {
      continue;
    }
    if (current[field] === base[field]) {
      next[field] = desired[field];
    } else {
      conflict = true;
    }
  }
  const favorite = changedFields.has("favorite")
    ? operation.desired.favorite
    : current.favorite;
  const archived = changedFields.has("archived")
    ? operation.desired.archived
    : current.archived;
  const { collectionId, copyCollectionId, organizationNotice } =
    await reconcileCollectionAssignment(
      savepoint,
      envelope,
      operation,
      current
    );
  const changed =
    collectionId !== current.collection_id ||
    favorite !== current.favorite ||
    archived !== current.archived ||
    promptTextFields.some((field) => next[field] !== current[field]);
  const preserved = conflict ? prepareConflictCopy(desired) : null;
  const {
    id: copyId,
    noticeId,
    bytes: copyBytes,
  } = preserved ?? { id: null, noticeId: null, bytes: 0 };
  const delta = promptTextFields.reduce(
    (sum, field) => sum + utf8Bytes(next[field]) - utf8Bytes(current[field]),
    copyBytes
  );
  const countExceeded =
    conflict && library.prompt_count >= promptLimits.promptCount;
  if (
    countExceeded ||
    Number(library.text_bytes) + delta > promptLimits.libraryBytes
  ) {
    throw new PromptFailureError({
      code: "quota_exceeded",
      message: `This edit cannot be preserved because your library has reached its ${countExceeded ? "10,000 prompt" : "100 MiB text"} capacity. Your server prompt is unchanged. Keep this tab open, correct or copy your draft, and retry. Archiving does not free capacity.`,
      resource: countExceeded ? "promptCount" : "textBytes",
      usage: {
        promptCount: library.prompt_count,
        textBytes: Number(library.text_bytes),
      },
      retryable: true,
    });
  }
  const [accepted] =
    await savepoint`UPDATE library SET revision = revision + 1, text_bytes = text_bytes + ${delta}, prompt_count = prompt_count + ${conflict ? 1 : 0}
        WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
  if (changed) {
    await savepoint`UPDATE prompt SET title = ${next.title}, description = ${next.description}, content = ${next.content},
          favorite_revision = CASE WHEN favorite <> ${favorite} THEN ${accepted.revision}::bigint ELSE favorite_revision END,
          archived_revision = CASE WHEN archived <> ${archived} THEN ${accepted.revision}::bigint ELSE archived_revision END,
          favorite = ${favorite}, archived = ${archived},
          collection_revision = CASE WHEN collection_id IS DISTINCT FROM ${collectionId}::uuid THEN ${accepted.revision}::bigint ELSE collection_revision END,
          collection_id = ${collectionId},
          title_revision = CASE WHEN title <> ${next.title} THEN ${accepted.revision}::bigint ELSE title_revision END,
          description_revision = CASE WHEN description <> ${next.description} THEN ${accepted.revision}::bigint ELSE description_revision END,
          content_revision = CASE WHEN content <> ${next.content} THEN ${accepted.revision}::bigint ELSE content_revision END,
          revision = ${accepted.revision}, modified_at = GREATEST(${accepted.accepted_at}, modified_at + interval '1 millisecond')
          WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND id = ${operation.promptId}`;
  }
  if (preserved) {
    await persistConflictCopy({
      sql: savepoint,
      instanceId: library.instance_id,
      accountId: browser.accountId,
      originalId: operation.promptId,
      revision: accepted.revision,
      acceptedAt: accepted.accepted_at,
      copy: preserved,
      collectionId: copyCollectionId,
    });
  }
  await savepoint`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, prompt_id, revision, accepted_at, conflict_copy_id, conflict_notice_id, organization_notice)
        VALUES (${library.instance_id}, ${browser.accountId}, ${operation.operationId}, ${envelope.epoch}, ${envelope.installationId}, 1, ${hash}, ${operation.kind}, ${operation.promptId}, ${accepted.revision}, ${accepted.accepted_at}, ${copyId}, ${noticeId}, ${organizationNotice})`;
  await savepoint`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, prompt_id, accepted_at)
        VALUES (${library.instance_id}, ${browser.accountId}, ${accepted.revision}, ${operation.operationId}, ${operation.kind}, ${operation.promptId}, ${accepted.accepted_at})`;
  return receiptFrom(
    receiptColumns.parse({
      ...accepted,
      operation_id: operation.operationId,
      prompt_id: operation.promptId,
      organization_notice: organizationNotice,
      conflict_copy_id: copyId,
      conflict_notice_id: noticeId,
    })
  );
};
const applyPromptCreation = async ({
  savepoint,
  browser,
  library,
  envelope,
  operation,
  desired,
  hash,
}: {
  savepoint: SQL;
  browser: BrowserAccount;
  library: LibraryRow;
  envelope: MutationEnvelope;
  operation: CreatePrompt | DuplicatePrompt;
  desired: PromptText;
  hash: string;
}) => {
  const collectionId = await validateCollectionReference(
    savepoint,
    envelope,
    operation.desired.collectionId
  );
  const sourceTitle =
    operation.kind === "prompt.duplicate" ? desired.title : null;
  if (operation.kind === "prompt.duplicate") {
    const [source] =
      await savepoint`SELECT id FROM prompt WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND id = ${operation.sourceId}
            UNION ALL SELECT prompt_id FROM library_operation WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND (prompt_id = ${operation.sourceId} OR conflict_copy_id = ${operation.sourceId}) LIMIT 1`;
    if (!source) {
      throw new PromptFailureError(
        {
          code: "not_found",
          message: "This source is not available in your library.",
          retryable: false,
        },
        404
      );
    }
    desired.title = duplicatePromptTitle(desired.title);
  }
  const used =
    await savepoint`SELECT prompt_id FROM library_operation WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND (prompt_id = ${operation.promptId} OR conflict_copy_id = ${operation.promptId} OR collection_id = ${operation.promptId} OR tag_id = ${operation.promptId})`;
  if (used.length) {
    throw new PromptFailureError(
      {
        code: "identity_unavailable",
        message: "This prompt identity has already been used.",
        retryable: false,
      },
      409
    );
  }
  const bytes =
    utf8Bytes(desired.title) +
    utf8Bytes(desired.description) +
    utf8Bytes(desired.content) +
    utf8Bytes(sourceTitle ?? "");
  const usage = {
    promptCount: library.prompt_count,
    textBytes: Number(library.text_bytes),
  };
  const resource =
    usage.promptCount >= promptLimits.promptCount ? "promptCount" : "textBytes";
  if (
    usage.promptCount >= promptLimits.promptCount ||
    usage.textBytes + bytes > promptLimits.libraryBytes
  ) {
    throw new PromptFailureError({
      code: "quota_exceeded",
      message:
        resource === "promptCount"
          ? "Your library has reached 10,000 prompts. Archiving does not free capacity."
          : "This prompt would exceed the library's 100 MiB text capacity. Archiving does not free capacity.",
      retryable: true,
      resource,
      usage,
    });
  }
  const [updated] =
    await savepoint`UPDATE library SET revision = revision + 1, prompt_count = prompt_count + 1, text_bytes = text_bytes + ${bytes}
    WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
  const revision = String(updated.revision);
  const acceptedAt: Date = updated.accepted_at;
  await savepoint`INSERT INTO prompt(instance_id, account_id, id, title, description, content, source_title, revision, title_revision, description_revision, content_revision, created_at, modified_at, collection_id, collection_revision)
    VALUES (${library.instance_id}, ${browser.accountId}, ${operation.promptId}, ${desired.title}, ${desired.description}, ${desired.content}, ${sourceTitle}, ${revision}, ${revision}, ${revision}, ${revision}, ${acceptedAt}, ${acceptedAt}, ${collectionId}, ${revision})`;
  const initialTags = operation.desired.tagIds ?? [];
  const tagsAdjusted = await initializePromptTags(
    savepoint,
    envelope,
    operation.promptId,
    initialTags,
    revision
  );
  const organizationNotice =
    tagsAdjusted || collectionId !== (operation.desired.collectionId ?? null)
      ? "Removed or merged organization assignments were adjusted. Your prompt was kept."
      : null;
  await savepoint`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, prompt_id, revision, accepted_at)
    VALUES (${library.instance_id}, ${browser.accountId}, ${operation.operationId}, ${envelope.epoch}, ${envelope.installationId}, 1, ${hash}, ${operation.kind}, ${operation.promptId}, ${revision}, ${acceptedAt})`;
  await savepoint`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, prompt_id, accepted_at)
    VALUES (${library.instance_id}, ${browser.accountId}, ${revision}, ${operation.operationId}, ${operation.kind}, ${operation.promptId}, ${acceptedAt})`;
  if (organizationNotice) {
    await savepoint`UPDATE library_operation SET organization_notice = ${organizationNotice} WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND operation_id = ${operation.operationId}`;
  }
  return mutationReceiptSchema.parse({
    status: "accepted",
    operationId: operation.operationId,
    promptId: operation.promptId,
    revision,
    acceptedAt: acceptedAt.toISOString(),
    organizationNotice: organizationNotice ?? undefined,
  });
};
const inspectOperation = async (
  tx: TransactionSQL,
  browser: BrowserAccount,
  envelope: MutationEnvelope,
  operation: MutationEnvelope["operations"][number]
) => {
  const library = await lockLibrary(tx, browser);
  if (
    envelope.accountId !== browser.accountId ||
    envelope.instanceId !== library.instance_id
  ) {
    throw new PromptFailureError(
      {
        code: "forbidden",
        message: "This operation belongs to a different library.",
        retryable: false,
      },
      403
    );
  }
  if (envelope.epoch !== library.recovery_epoch) {
    throw new PromptFailureError(
      {
        code: "snapshot_required",
        message: "This instance was recovered. Retain local work for recovery.",
        retryable: false,
      },
      409
    );
  }
  const desired =
    "desired" in operation
      ? {
          title: trimPromptText(operation.desired.title),
          description: trimPromptText(operation.desired.description),
          content: operation.desired.content,
        }
      : null;
  const hash = operationFingerprint(envelope, operation, desired);
  const [existing] =
    await tx`SELECT used_at, organization_effect, operation_id, prompt_id, collection_id, tag_id, resolved_tag_id, tag_outcome, revision::text, accepted_at, request_hash, conflict_copy_id, conflict_notice_id, organization_notice FROM library_operation WHERE instance_id=${library.instance_id} AND account_id=${browser.accountId} AND operation_id=${operation.operationId}`;
  const [attempt] = existing
    ? [existing]
    : await tx`SELECT request_hash FROM library_operation_attempt WHERE instance_id=${library.instance_id} AND account_id=${browser.accountId} AND operation_id=${operation.operationId}`;
  if (attempt && attempt.request_hash !== hash) {
    throw new PromptFailureError(
      {
        code: "operation_identity_reused",
        message:
          "This operation identity was already used for different content.",
        retryable: false,
      },
      409
    );
  }
  return { library, desired, hash, existing };
};
export const lookupPromptReceipt = (
  browser: BrowserAccount,
  envelope: MutationEnvelope,
  operation: MutationEnvelope["operations"][number]
) =>
  database().begin(async (tx) => {
    const { existing } = await inspectOperation(
      tx,
      browser,
      envelope,
      operation
    );
    return existing
      ? receiptFrom(receiptColumns.parse(existing))
      : { status: "unknown" as const, operationId: operation.operationId };
  });
export const mutatePrompt = (
  browser: BrowserAccount,
  envelope: MutationEnvelope,
  operation: MutationEnvelope["operations"][number]
) =>
  database().begin(async (tx) => {
    const { library, desired, hash, existing } = await inspectOperation(
      tx,
      browser,
      envelope,
      operation
    );
    if (existing) {
      return receiptFrom(receiptColumns.parse(existing));
    }
    await tx`INSERT INTO library_operation_attempt(instance_id, account_id, operation_id, request_hash)
      VALUES (${library.instance_id}, ${browser.accountId}, ${operation.operationId}, ${hash}) ON CONFLICT DO NOTHING`;
    try {
      return await tx.savepoint(async (savepoint) => {
        const receipt = await (async () => {
          const parsed = promptTextSchema.safeParse(desired);
          if (desired && !parsed.success) {
            const fields = Object.fromEntries(
              parsed.error.issues.map((issue) => [
                String(issue.path[0]),
                issue.message,
              ])
            );
            throw new PromptFailureError({
              code: "validation_failed",
              message: "Correct the highlighted prompt fields.",
              retryable: false,
              fields,
            });
          }
          if (BigInt(operation.baseRevision) > BigInt(library.revision)) {
            throw invalidPromptRequest();
          }
          if (operation.dependsOn.length) {
            const [dependencies] =
              await savepoint`SELECT count(*)::int AS count FROM library_operation WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND operation_id IN ${savepoint(operation.dependsOn)}`;
            if (dependencies.count !== new Set(operation.dependsOn).size) {
              throw new PromptFailureError(
                {
                  code: "dependency_blocked",
                  message:
                    "A required earlier operation has not been accepted.",
                  retryable: true,
                },
                409
              );
            }
          }
          if (
            operation.kind === "collection.delete" ||
            operation.kind === "tag.delete" ||
            operation.kind === "tag.merge"
          ) {
            return applyOrganizationCleanup(
              savepoint,
              envelope,
              operation,
              hash
            );
          }
          if ("collectionId" in operation) {
            return applyCollection(savepoint, envelope, operation, hash);
          }
          if ("tagId" in operation) {
            return applyTag(savepoint, envelope, operation, hash);
          }
          if (operation.kind === "prompt.tags") {
            return applyTagAssignments(savepoint, envelope, operation, hash);
          }
          if (operation.kind === "prompt.use") {
            return applyPromptUse(savepoint, envelope, operation, hash);
          }
          if (
            operation.kind === "conflict.review" ||
            operation.kind === "organization.review"
          ) {
            return reviewConflict(savepoint, envelope, operation, hash);
          }
          if (operation.kind === "prompt.delete") {
            return applyPromptDeletion({
              sql: savepoint,
              envelope,
              operation,
              hash,
            });
          }
          if (!desired) {
            throw invalidPromptRequest();
          }
          if (operation.kind === "prompt.update") {
            return applyPromptUpdate({
              savepoint,
              browser,
              library,
              envelope,
              operation,
              desired,
              hash,
            });
          }
          return applyPromptCreation({
            savepoint,
            browser,
            library,
            envelope,
            operation,
            desired,
            hash,
          });
        })();
        await captureChange(savepoint, envelope, receipt);
        return receipt;
      });
    } catch (error) {
      return {
        status: "rejected" as const,
        error: {
          ...promptFailure(
            error instanceof Error ? error : new Error("Mutation failed")
          ).detail,
          operationId: operation.operationId,
        },
      };
    }
  });

const cursorSchema = z.strictObject({
  account: z.string(),
  instance: z.string(),
  epoch: z.string(),
  version: z.literal(2),
  kind: z.enum(["prompts", "conflicts", "adjustments"]),
  revision: z.string(),
  after: z.string().regex(/^\d+$/u),
  afterId: z.uuid(),
  limit: z.number(),
  view: promptViewSchema.optional(),
  collectionId: z.uuidv4().optional(),
  tagFilter: z.string().optional(),
});
const signature = (payload: string) =>
  createHmac("sha256", configuration().authSecret)
    .update(`prompt-page-v1:${payload}`)
    .digest("base64url");
const readCursor = (cursor: string) => {
  const [payload = "", supplied = ""] = cursor.split(".");
  const expected = signature(payload);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    throw invalidPromptRequest();
  }
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"))
    );
  } catch {
    throw invalidPromptRequest();
  }
};
type PageScope = Pick<
  z.infer<typeof cursorSchema>,
  | "account"
  | "instance"
  | "epoch"
  | "revision"
  | "kind"
  | "limit"
  | "view"
  | "collectionId"
  | "tagFilter"
>;
const scopedCursor = (cursor: string | undefined, scope: PageScope) => {
  if (!cursor) {
    return;
  }
  const page = readCursor(cursor);
  if (
    page.account !== scope.account ||
    page.instance !== scope.instance ||
    page.epoch !== scope.epoch ||
    page.kind !== scope.kind ||
    page.limit !== scope.limit ||
    page.view !== scope.view ||
    page.collectionId !== scope.collectionId ||
    page.tagFilter !== scope.tagFilter
  ) {
    throw invalidPromptRequest();
  }
  if (page.revision !== scope.revision) {
    throw new PromptFailureError(
      {
        code: "results_changed",
        message: "Your library changed. Refresh the list to continue.",
        retryable: true,
      },
      409
    );
  }
  return page;
};
const signCursor = (
  scope: PageScope,
  last: { id: string; revision: string } | undefined
) => {
  if (!last) {
    throw new Error("Missing page boundary");
  }
  const payload = Buffer.from(
    JSON.stringify({
      ...scope,
      version: 2,
      after: last.revision,
      afterId: last.id,
    })
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
};
interface PromptRow {
  id: string;
  title: string;
  description: string;
  content?: string;
  revision: string;
  created_at: Date;
  modified_at: Date;
  favorite: boolean;
  archived: boolean;
  use_count: number;
  last_used_at: Date | null;
  source_title: string | null;
  collection_id: string | null;
  tag_ids?: string[];
}
export const summaryFrom = (row: PromptRow) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  revision: row.revision,
  createdAt: row.created_at.toISOString(),
  modifiedAt: row.modified_at.toISOString(),
  favorite: row.favorite,
  archived: row.archived,
  collectionId: row.collection_id,
  tagIds: row.tag_ids ?? [],
});
export const getPrompt = (browser: BrowserAccount, id: string) =>
  database().begin(async (tx) => {
    const library = await lockLibrary(tx, browser);
    const [row] = await tx<
      PromptRow[]
    >`SELECT id, title, description, content, coalesce(source_title,(SELECT n.source_title FROM conflict_notice n WHERE n.instance_id=prompt.instance_id AND n.account_id=prompt.account_id AND n.copy_id=prompt.id LIMIT 1)) AS source_title, revision::text, created_at, modified_at, favorite, archived, collection_id, use_count, last_used_at FROM prompt
    WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND id = ${id}`;
    if (!row) {
      throw new PromptFailureError(
        {
          code: "not_found",
          message: "This prompt is not available in your library.",
          retryable: false,
        },
        404
      );
    }
    return promptSchema.parse({
      ...summaryFrom(row),
      libraryRevision: library.revision,
      tagIds: await promptTagIds(
        tx,
        { instanceId: library.instance_id, accountId: browser.accountId },
        id
      ),
      content: row.content,
      instanceId: library.instance_id,
      accountId: browser.accountId,
      favorite: row.favorite,
      archived: row.archived,
      useCount: row.use_count,
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
      sourceTitle: row.source_title,
    });
  });

export const listConflicts = (
  browser: BrowserAccount,
  limit: number,
  cursor?: string
) =>
  database().begin(async (tx) => {
    const library = await lockLibrary(tx, browser);
    const scope = {
      account: browser.accountId,
      instance: library.instance_id,
      epoch: library.recovery_epoch,
      revision: library.revision,
      kind: "conflicts",
      limit,
    } as const;
    const page = scopedCursor(cursor, scope);
    const rows = await tx<
      {
        id: string;
        original_id: string;
        original_deleted: boolean;
        original_archived: boolean;
        copy_deleted: boolean;
        copy_id: string;
        source_title: string;
        revision: string;
        created_at: Date;
      }[]
    >`SELECT id, original_id, copy_id, source_title, revision::text, created_at,
      EXISTS(SELECT 1 FROM prompt p WHERE p.instance_id = conflict_notice.instance_id AND p.account_id = conflict_notice.account_id AND p.id = conflict_notice.original_id AND p.archived) AS original_archived,
      EXISTS(SELECT 1 FROM prompt_deletion d WHERE d.instance_id = conflict_notice.instance_id AND d.account_id = conflict_notice.account_id AND d.prompt_id = conflict_notice.copy_id) AS copy_deleted,
      EXISTS(SELECT 1 FROM prompt_deletion d WHERE d.instance_id = conflict_notice.instance_id AND d.account_id = conflict_notice.account_id AND d.prompt_id = conflict_notice.original_id) AS original_deleted FROM conflict_notice
    WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND reviewed_at IS NULL
      AND (revision < ${page?.after ?? "9223372036854775807"}::bigint OR (revision = ${page?.after ?? "9223372036854775807"}::bigint AND id > ${page?.afterId ?? "00000000-0000-0000-0000-000000000000"}::uuid))
    ORDER BY conflict_notice.revision DESC, id LIMIT ${limit + 1}`;
    const visible = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit ? signCursor(scope, visible.at(-1)) : null;
    return conflictPageSchema.parse({
      instanceId: library.instance_id,
      accountId: browser.accountId,
      revision: library.revision,
      nextCursor,
      notices: visible.map((row) => ({
        id: row.id,
        originalId: row.original_id,
        originalDeleted: row.original_deleted,
        originalArchived: row.original_archived,
        copyDeleted: row.copy_deleted,
        copyId: row.copy_id,
        sourceTitle: row.source_title,
        revision: row.revision,
        createdAt: row.created_at.toISOString(),
      })),
    });
  });

export const listAdjustments = (
  browser: BrowserAccount,
  limit: number,
  cursor?: string
) =>
  database().begin(async (tx) => {
    const library = await lockLibrary(tx, browser);
    const scope = {
      account: browser.accountId,
      instance: library.instance_id,
      epoch: library.recovery_epoch,
      revision: library.revision,
      kind: "adjustments",
      limit,
    } as const;
    const page = scopedCursor(cursor, scope);
    const rows = await tx<
      {
        id: string;
        prompt_id: string;
        message: string;
        revision: string;
        accepted_at: Date;
      }[]
    >`SELECT o.operation_id AS id,o.prompt_id,o.organization_notice AS message,o.revision::text,o.accepted_at FROM library_operation o
    WHERE o.instance_id=${library.instance_id} AND o.account_id=${browser.accountId} AND o.organization_notice IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM library_operation a WHERE a.instance_id=o.instance_id AND a.account_id=o.account_id AND a.kind='organization.review' AND a.conflict_notice_id=o.operation_id)
    AND (o.revision < ${page?.after ?? "9223372036854775807"}::bigint OR (o.revision = ${page?.after ?? "9223372036854775807"}::bigint AND o.operation_id > ${page?.afterId ?? "00000000-0000-0000-0000-000000000000"}::uuid))
    ORDER BY o.revision DESC,o.operation_id LIMIT ${limit + 1}`;
    const visible = rows.slice(0, limit);
    return adjustmentPageSchema.parse({
      instanceId: library.instance_id,
      accountId: browser.accountId,
      revision: library.revision,
      nextCursor:
        rows.length > limit ? signCursor(scope, visible.at(-1)) : null,
      notices: visible.map((row) => ({
        id: row.id,
        promptId: row.prompt_id,
        message: row.message,
        revision: row.revision,
        createdAt: row.accepted_at.toISOString(),
      })),
    });
  });

export const getOrganization = (browser: BrowserAccount) =>
  database().begin(async (tx) => {
    const library = await lockLibrary(tx, browser);
    return readOrganization(tx, {
      instanceId: library.instance_id,
      accountId: browser.accountId,
      revision: library.revision,
      textBytes: Number(library.text_bytes),
    });
  });
