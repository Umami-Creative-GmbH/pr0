// oxlint-disable react-doctor/server-sequential-independent-await -- All effects share the caller's serialized library transaction.
import "server-only";
import {
  mutationResultSchema,
  organizationEffectSchema,
  utf8Bytes,
} from "@pr0/api-contract/prompts";
import type {
  LibraryScope,
  MutationEnvelope,
  OrganizationCleanup,
} from "@pr0/api-contract/prompts";
import type { SQL } from "bun";

import { PromptFailureError } from "./prompt-errors";

export const unavailableOrganization = () =>
  new PromptFailureError(
    {
      code: "not_found",
      message:
        "This organization identity is no longer available in your library. Refresh the confirmation.",
      retryable: false,
    },
    404
  );

const tagAssignments = (
  sql: SQL,
  { instanceId, accountId }: LibraryScope,
  id: string
) =>
  sql<
    { id: string; archived: boolean }[]
  >`SELECT p.id, p.archived FROM prompt_tag m JOIN prompt p ON p.instance_id = m.instance_id AND p.account_id = m.account_id AND p.id = m.prompt_id WHERE m.instance_id = ${instanceId} AND m.account_id = ${accountId} AND m.tag_id = ${id} AND m.add_revision > m.remove_revision`;

export const organizationImpact = async (
  sql: SQL,
  scope: LibraryScope,
  input: {
    kind: OrganizationCleanup["kind"];
    sourceId: string;
    targetId?: string;
  }
) => {
  const { instanceId, accountId } = scope;
  // Bulk work must stay set-based even before PostgreSQL has analysed a fresh library.
  // Transaction-local: avoid the measured 10,000 × 10,000 nested-loop plan.
  await sql`SET LOCAL enable_nestloop = off`;
  const collection = input.kind === "collection.delete";
  const sourceRows = collection
    ? await sql`SELECT name, revision::text FROM collection WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${input.sourceId}`
    : await sql`SELECT name, revision::text FROM tag WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${input.sourceId}`;
  const [source] = sourceRows;
  if (!source) {
    throw unavailableOrganization();
  }
  let target: { name: string; revision: string } | undefined;
  if (input.kind === "tag.merge") {
    if (!input.targetId || input.sourceId === input.targetId) {
      throw unavailableOrganization();
    }
    [target] =
      await sql`SELECT name, revision::text FROM tag WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${input.targetId}`;
    if (!target) {
      throw unavailableOrganization();
    }
  }
  const rows: { id: string; archived: boolean }[] = collection
    ? await sql`SELECT id, archived FROM prompt WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND collection_id = ${input.sourceId}`
    : await tagAssignments(sql, scope, input.sourceId);
  const targetRows: { id: string; archived: boolean }[] = target
    ? await tagAssignments(sql, scope, input.targetId ?? "")
    : [];
  const combined = new Map(
    [...rows, ...targetRows].map((row) => [row.id, row])
  );
  const effect = organizationEffectSchema.parse({
    ...input,
    sourceName: source.name,
    targetId: input.targetId ?? null,
    targetName: target?.name ?? null,
    activeCount: rows.filter((row) => !row.archived).length,
    archivedCount: rows.filter((row) => row.archived).length,
    targetActiveCount: target
      ? [...combined.values()].filter((row) => !row.archived).length
      : 0,
    targetArchivedCount: target
      ? [...combined.values()].filter((row) => row.archived).length
      : 0,
  });
  return {
    effect,
    rows,
    sourceRevision: source.revision,
    targetRevision: target?.revision,
  };
};

export const applyOrganizationCleanup = async (
  sql: SQL,
  envelope: MutationEnvelope,
  operation: OrganizationCleanup,
  hash: string
) => {
  const { instanceId, accountId } = envelope;
  const collection = operation.kind === "collection.delete";
  const sourceId =
    "collectionId" in operation ? operation.collectionId : operation.tagId;
  const targetId =
    operation.kind === "tag.merge" ? operation.targetId : undefined;
  const { effect, sourceRevision, targetRevision } = await organizationImpact(
    sql,
    envelope,
    { kind: operation.kind, sourceId, targetId }
  );
  if (
    BigInt(sourceRevision) > BigInt(operation.baseRevision) ||
    (targetRevision && BigInt(targetRevision) > BigInt(operation.baseRevision))
  ) {
    throw new PromptFailureError(
      {
        code: "results_changed",
        message:
          "An organization name changed. Refresh and confirm the named action again.",
        retryable: true,
      },
      409
    );
  }
  const [accepted] =
    await sql`UPDATE library SET revision = revision + 1, text_bytes = text_bytes - ${utf8Bytes(effect.sourceName)}, collection_count = collection_count - ${collection ? 1 : 0}, tag_count = tag_count - ${collection ? 0 : 1} WHERE instance_id = ${instanceId} AND account_id = ${accountId} RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
  const { revision, accepted_at: acceptedAt } = accepted;
  await sql`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, collection_id, tag_id, revision, accepted_at, organization_effect) VALUES (${instanceId}, ${accountId}, ${operation.operationId}, ${envelope.epoch}, ${envelope.installationId}, 1, ${hash}, ${operation.kind}, ${collection ? sourceId : null}, ${collection ? null : sourceId}, ${revision}, ${acceptedAt}, ${effect}::jsonb)`;
  if (collection) {
    await sql`INSERT INTO organization_affected SELECT ${instanceId}::uuid, ${accountId}, ${operation.operationId}::uuid, id, archived FROM prompt WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND collection_id = ${sourceId}`;
    await sql`UPDATE prompt SET collection_id = NULL, collection_revision = ${revision}, revision = ${revision}, modified_at = GREATEST(${acceptedAt}, modified_at + interval '1 millisecond') WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND collection_id = ${sourceId}`;
    await sql`DELETE FROM collection WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${sourceId}`;
  } else {
    await sql`INSERT INTO organization_affected SELECT ${instanceId}::uuid, ${accountId}, ${operation.operationId}::uuid, p.id, p.archived FROM prompt_tag m JOIN prompt p ON p.instance_id = m.instance_id AND p.account_id = m.account_id AND p.id = m.prompt_id WHERE m.instance_id = ${instanceId} AND m.account_id = ${accountId} AND m.tag_id = ${sourceId} AND m.add_revision > m.remove_revision`;
    if (targetId) {
      await sql`INSERT INTO prompt_tag(instance_id, account_id, prompt_id, tag_id, add_revision) SELECT instance_id, account_id, prompt_id, ${targetId}::uuid, ${revision}::bigint FROM organization_affected WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND operation_id = ${operation.operationId} ON CONFLICT(instance_id, account_id, prompt_id, tag_id) DO UPDATE SET add_revision = EXCLUDED.add_revision`;
    }
    await sql`UPDATE prompt_tag SET remove_revision = ${revision}, merge_revision = ${targetId ? revision : "0"} WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND tag_id = ${sourceId} AND add_revision > remove_revision`;
    await sql`UPDATE prompt SET revision = ${revision}, modified_at = GREATEST(${acceptedAt}, modified_at + interval '1 millisecond') WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id IN (SELECT prompt_id FROM organization_affected WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND operation_id = ${operation.operationId})`;
    await sql`DELETE FROM tag WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${sourceId}`;
  }
  await sql`INSERT INTO organization_removed(instance_id, account_id, id, entity, name, revision, target_id) VALUES (${instanceId}, ${accountId}, ${sourceId}, ${collection ? "collection" : "tag"}, ${effect.sourceName}, ${revision}, ${targetId ?? null})`;
  // One compact change describes relation cleanup. Consumers apply it to all assignments.
  await sql`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, collection_id, tag_id, accepted_at, organization_effect) VALUES (${instanceId}, ${accountId}, ${revision}, ${operation.operationId}, ${operation.kind}, ${collection ? sourceId : null}, ${collection ? null : sourceId}, ${acceptedAt}, ${effect}::jsonb)`;
  return mutationResultSchema.parse({
    status: "accepted",
    operationId: operation.operationId,
    revision,
    acceptedAt: acceptedAt.toISOString(),
    effect,
  });
};
