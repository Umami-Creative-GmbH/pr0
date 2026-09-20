// oxlint-disable react-doctor/server-sequential-independent-await -- All effects belong to the same serialized mutation transaction.
import "server-only";
import { mutationReceiptSchema, promptLimits } from "@pr0/api-contract/prompts";
import type {
  DeletePrompt,
  MutationEnvelope,
  UpdatePrompt,
  PromptText,
} from "@pr0/api-contract/prompts";
import type { SQL } from "bun";

import { prepareConflictCopy, persistConflictCopy } from "./prompt-conflict";
import { PromptFailureError } from "./prompt-errors";

interface DeletionContext {
  sql: SQL;
  envelope: MutationEnvelope;
  operation: DeletePrompt | UpdatePrompt;
  hash: string;
}
const unavailable = () =>
  new PromptFailureError(
    {
      code: "not_found",
      message: "This prompt is not available in your library.",
      retryable: false,
    },
    404
  );

const commitDeletionOutcome = async (
  { sql, envelope, operation, hash }: DeletionContext,
  {
    copy,
    removedBytes,
    removeOriginal,
  }: { copy?: PromptText; removedBytes: number; removeOriginal: boolean }
) => {
  const { instanceId, accountId } = envelope;
  const preserved = copy ? prepareConflictCopy(copy) : null;
  const addedBytes = preserved?.bytes ?? 0;
  const delta = addedBytes - removedBytes;
  const countDelta = (copy ? 1 : 0) - (removeOriginal ? 1 : 0);
  const [library] =
    await sql`SELECT prompt_count, text_bytes::text FROM library WHERE instance_id = ${instanceId} AND account_id = ${accountId}`;
  const countExceeded =
    library.prompt_count + countDelta > promptLimits.promptCount;
  if (
    countExceeded ||
    Number(library.text_bytes) + delta > promptLimits.libraryBytes
  ) {
    throw new PromptFailureError({
      code: "quota_exceeded",
      retryable: true,
      resource: countExceeded ? "promptCount" : "textBytes",
      usage: {
        promptCount: library.prompt_count,
        textBytes: Number(library.text_bytes),
      },
      message:
        "Unseen text needs a conflict copy, but your library has reached capacity. Nothing was changed. Keep this tab open, free capacity, and retry; your pending action or draft is retained.",
    });
  }
  const [accepted] =
    await sql`UPDATE library SET revision = revision + 1, prompt_count = prompt_count + ${countDelta}, text_bytes = text_bytes + ${delta}
    WHERE instance_id = ${instanceId} AND account_id = ${accountId} RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
  if (operation.kind === "prompt.delete") {
    await sql`INSERT INTO prompt_deletion(instance_id, account_id, prompt_id, revision, deleted_at)
      VALUES (${instanceId}, ${accountId}, ${operation.promptId}, ${accepted.revision}, ${accepted.accepted_at}) ON CONFLICT DO NOTHING`;
    await sql`DELETE FROM prompt WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${operation.promptId}`;
    await sql`DELETE FROM conflict_notice WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND copy_id = ${operation.promptId}`;
  }
  const copyId = preserved?.id ?? null;
  const noticeId = preserved?.noticeId ?? null;
  if (preserved) {
    await persistConflictCopy({
      sql,
      instanceId,
      accountId,
      originalId: operation.promptId,
      revision: accepted.revision,
      acceptedAt: accepted.accepted_at,
      copy: preserved,
    });
  }
  await sql`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, prompt_id, revision, accepted_at, conflict_copy_id, conflict_notice_id)
    VALUES (${instanceId}, ${accountId}, ${operation.operationId}, ${envelope.epoch}, ${envelope.installationId}, 1, ${hash}, ${operation.kind}, ${operation.promptId}, ${accepted.revision}, ${accepted.accepted_at}, ${copyId}, ${noticeId})`;
  await sql`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, prompt_id, accepted_at)
    VALUES (${instanceId}, ${accountId}, ${accepted.revision}, ${operation.operationId}, ${operation.kind}, ${operation.promptId}, ${accepted.accepted_at})`;
  return mutationReceiptSchema.parse({
    status: "accepted",
    operationId: operation.operationId,
    promptId: operation.promptId,
    revision: accepted.revision,
    acceptedAt: accepted.accepted_at.toISOString(),
    conflict: copy ? { copyId, noticeId } : undefined,
  });
};

export const applyPromptDeletion = async (
  context: DeletionContext & { operation: DeletePrompt }
) => {
  const {
    sql,
    envelope: { instanceId, accountId },
    operation,
  } = context;
  const [current] =
    await sql`SELECT title, description, content, greatest(title_revision, description_revision, content_revision)::text AS text_revision,
    octet_length(title) + octet_length(description) + octet_length(content) + octet_length(coalesce(source_title, '')) AS bytes
    FROM prompt WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${operation.promptId}`;
  const [deleted] =
    await sql`SELECT prompt_id FROM prompt_deletion WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND prompt_id = ${operation.promptId}`;
  if (!current && !deleted) {
    throw unavailable();
  }
  const [notices] =
    await sql`SELECT coalesce(sum(octet_length(source_title)), 0)::text AS bytes FROM conflict_notice WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND copy_id = ${operation.promptId}`;
  const copy =
    current && BigInt(current.text_revision) > BigInt(operation.baseRevision)
      ? {
          title: current.title,
          description: current.description,
          content: current.content,
        }
      : undefined;
  return commitDeletionOutcome(context, {
    copy,
    removedBytes: (current?.bytes ?? 0) + Number(notices.bytes),
    removeOriginal: Boolean(current),
  });
};

export const preserveDeletedPromptEdit = async (
  context: DeletionContext & { operation: UpdatePrompt },
  desired: PromptText
) => {
  const {
    sql,
    envelope: { instanceId, accountId },
    operation,
  } = context;
  const [deleted] =
    await sql`SELECT prompt_id FROM prompt_deletion WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND prompt_id = ${operation.promptId}`;
  if (
    !deleted ||
    !operation.changedFields.some(
      (field) =>
        field === "title" || field === "description" || field === "content"
    )
  ) {
    throw unavailable();
  }
  return commitDeletionOutcome(context, {
    copy: desired,
    removedBytes: 0,
    removeOriginal: false,
  });
};
