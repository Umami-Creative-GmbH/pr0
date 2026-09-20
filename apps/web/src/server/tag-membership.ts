// oxlint-disable react-doctor/server-sequential-independent-await -- Reads and writes share the caller's serialized library transaction.
import "server-only";
import { mutationReceiptSchema, promptLimits } from "@pr0/api-contract/prompts";
import type {
  AssignTags,
  LibraryScope,
  MutationEnvelope,
} from "@pr0/api-contract/prompts";
import type { SQL } from "bun";

import { invalidPromptRequest, PromptFailureError } from "./prompt-errors";

export const initializePromptTags = async (
  sql: SQL,
  scope: LibraryScope,
  promptId: string,
  ids: string[],
  revision: string
) => {
  if (
    ids.length > promptLimits.tagsPerPrompt ||
    new Set(ids).size !== ids.length
  ) {
    throw invalidPromptRequest();
  }
  if (!ids.length) {
    return;
  }
  const [tags] =
    await sql`SELECT count(*)::int AS count FROM tag WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} AND id IN ${sql(ids)}`;
  if (tags.count !== ids.length) {
    throw new PromptFailureError({
      code: "validation_failed",
      message: "Choose available tags in this library.",
      fields: { tagIds: "A tag is not available in your library." },
      retryable: false,
    });
  }
  await sql`INSERT INTO prompt_tag(instance_id, account_id, prompt_id, tag_id, add_revision) SELECT ${scope.instanceId}::uuid, ${scope.accountId}, ${promptId}::uuid, id, ${revision}::bigint FROM tag WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} AND id IN ${sql(ids)}`;
};

export const copyPromptTags = async (
  sql: SQL,
  scope: LibraryScope,
  sourceId: string,
  copyId: string,
  revision: string
) => {
  await sql`INSERT INTO prompt_tag(instance_id, account_id, prompt_id, tag_id, add_revision) SELECT instance_id, account_id, ${copyId}::uuid, tag_id, ${revision}::bigint FROM prompt_tag WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} AND prompt_id = ${sourceId} AND add_revision > remove_revision`;
};

export const promptTagIds = async (
  sql: SQL,
  scope: LibraryScope,
  promptId: string
): Promise<string[]> => {
  const rows =
    await sql`SELECT tag_id FROM prompt_tag WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} AND prompt_id = ${promptId} AND add_revision > remove_revision ORDER BY tag_id`;
  return rows.map((row: { tag_id: string }) => row.tag_id);
};

export const applyTagAssignments = async (
  sql: SQL,
  envelope: MutationEnvelope,
  operation: AssignTags,
  hash: string
) => {
  const { instanceId, accountId } = envelope;
  const ids = [...operation.add, ...operation.remove];
  if (new Set(ids).size !== ids.length) {
    throw invalidPromptRequest();
  }
  const [prompt] =
    await sql`SELECT id FROM prompt WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${operation.promptId}`;
  if (!prompt) {
    throw new PromptFailureError(
      {
        code: "not_found",
        message: "This prompt is not available in your library.",
        retryable: false,
      },
      404
    );
  }
  if (ids.length) {
    const [tags] =
      await sql`SELECT count(*)::int AS count FROM tag WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id IN ${sql(ids)}`;
    if (tags.count !== ids.length) {
      throw new PromptFailureError({
        code: "validation_failed",
        message: "Choose available tags in this library.",
        fields: { tagIds: "A tag is not available in your library." },
        retryable: false,
      });
    }
  }
  const current = await sql<
    { tag_id: string; add_revision: string; remove_revision: string }[]
  >`SELECT tag_id, add_revision::text, remove_revision::text FROM prompt_tag WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND prompt_id = ${operation.promptId}`;
  const active = new Set<string>();
  for (const row of current) {
    if (BigInt(row.add_revision) > BigInt(row.remove_revision)) {
      active.add(row.tag_id);
    }
  }
  const additions = operation.add.filter((id) => {
    const membership = current.find((row) => row.tag_id === id);
    return (
      !membership ||
      BigInt(membership.remove_revision) <= BigInt(operation.baseRevision)
    );
  });
  const next = new Set(active);
  for (const id of operation.remove) {
    next.delete(id);
  }
  for (const id of additions) {
    next.add(id);
  }
  if (next.size > promptLimits.tagsPerPrompt) {
    throw new PromptFailureError({
      code: "quota_exceeded",
      resource: "tagsPerPrompt",
      message:
        "A prompt can have at most 20 tags. Remove a tag before adding another.",
      fields: { tagIds: "Choose at most 20 tags." },
      retryable: true,
    });
  }
  const changed =
    next.size !== active.size || [...next].some((id) => !active.has(id));
  const notice =
    additions.length === operation.add.length
      ? null
      : "An older tag add was ignored because a later removal was not observed. Refresh before deliberately adding the tag again.";
  const [accepted] =
    await sql`UPDATE library SET revision = revision + 1 WHERE instance_id = ${instanceId} AND account_id = ${accountId} RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
  if (additions.length) {
    await sql`INSERT INTO prompt_tag(instance_id, account_id, prompt_id, tag_id, add_revision)
      SELECT ${instanceId}::uuid, ${accountId}, ${operation.promptId}::uuid, id, ${accepted.revision}::bigint FROM tag WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id IN ${sql(additions)}
      ON CONFLICT(instance_id, account_id, prompt_id, tag_id) DO UPDATE SET add_revision = EXCLUDED.add_revision`;
  }
  if (operation.remove.length) {
    await sql`INSERT INTO prompt_tag(instance_id, account_id, prompt_id, tag_id, remove_revision)
      SELECT ${instanceId}::uuid, ${accountId}, ${operation.promptId}::uuid, id, ${accepted.revision}::bigint FROM tag WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id IN ${sql(operation.remove)}
      ON CONFLICT(instance_id, account_id, prompt_id, tag_id) DO UPDATE SET remove_revision = EXCLUDED.remove_revision`;
  }
  if (changed) {
    await sql`UPDATE prompt SET revision = ${accepted.revision}, modified_at = GREATEST(${accepted.accepted_at}, modified_at + interval '1 millisecond') WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${operation.promptId}`;
  }
  await sql`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, prompt_id, revision, accepted_at, organization_notice)
    VALUES (${instanceId}, ${accountId}, ${operation.operationId}, ${envelope.epoch}, ${envelope.installationId}, 1, ${hash}, ${operation.kind}, ${operation.promptId}, ${accepted.revision}, ${accepted.accepted_at}, ${notice})`;
  await sql`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, prompt_id, accepted_at) VALUES (${instanceId}, ${accountId}, ${accepted.revision}, ${operation.operationId}, ${operation.kind}, ${operation.promptId}, ${accepted.accepted_at})`;
  return mutationReceiptSchema.parse({
    status: "accepted",
    operationId: operation.operationId,
    promptId: operation.promptId,
    revision: accepted.revision,
    acceptedAt: accepted.accepted_at.toISOString(),
    organizationNotice: notice ?? undefined,
  });
};
