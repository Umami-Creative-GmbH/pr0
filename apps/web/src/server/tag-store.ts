// oxlint-disable react-doctor/server-sequential-independent-await -- Changes and receipts share the caller's serialized library transaction.
import "server-only";
import {
  organizationNameSchema,
  organizationIdentity,
  trimOrganizationName,
  compareOrganizationNames,
} from "@pr0/api-contract/organization";
import {
  mutationResultSchema,
  promptLimits,
  utf8Bytes,
} from "@pr0/api-contract/prompts";
import type {
  MutationEnvelope,
  TagOperation,
  Tag,
} from "@pr0/api-contract/prompts";
import type { SQL } from "bun";

import { PromptFailureError } from "./prompt-errors";

const validatedTagName = (value: string) => {
  const parsed = organizationNameSchema.safeParse(value);
  if (!parsed.success) {
    throw new PromptFailureError({
      code: "validation_failed",
      message: "Correct the tag name.",
      fields: { name: parsed.error.issues[0]?.message ?? "Invalid name." },
      retryable: false,
    });
  }
  return trimOrganizationName(parsed.data);
};

const checkTagCapacity = async (
  sql: SQL,
  { instanceId, accountId }: MutationEnvelope,
  added: boolean,
  delta: number
) => {
  const [library] =
    await sql`SELECT tag_count, text_bytes::text FROM library WHERE instance_id = ${instanceId} AND account_id = ${accountId}`;
  const countExceeded = added && library.tag_count >= promptLimits.tagCount;
  if (
    countExceeded ||
    (delta > 0 &&
      Number(library.text_bytes) + delta > promptLimits.libraryBytes)
  ) {
    throw new PromptFailureError({
      code: "quota_exceeded",
      resource: countExceeded ? "tagCount" : "textBytes",
      message: countExceeded
        ? "Your library has reached 1,000 tags. Use an existing tag or free a slot before creating another."
        : "This name would exceed the library's 100 MiB text capacity. Shorten the name or free text capacity.",
      retryable: true,
    });
  }
};

export const applyTag = async (
  sql: SQL,
  envelope: MutationEnvelope,
  operation: TagOperation,
  hash: string
) => {
  const { instanceId, accountId } = envelope;
  const name = validatedTagName(operation.name);
  const identity = organizationIdentity(name);
  const creating = operation.kind === "tag.create";
  const [current] =
    await sql`SELECT name FROM tag WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${operation.tagId}`;
  if (!creating && !current) {
    throw new PromptFailureError(
      {
        code: "not_found",
        message: "This tag is not available in your library.",
        retryable: false,
      },
      404
    );
  }
  const [used] =
    await sql`SELECT operation_id FROM library_operation WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND (tag_id = ${operation.tagId} OR collection_id = ${operation.tagId} OR prompt_id = ${operation.tagId} OR conflict_copy_id = ${operation.tagId}) LIMIT 1`;
  if (creating && (current || used)) {
    throw new PromptFailureError(
      {
        code: "identity_unavailable",
        message: "This tag identity has already been used.",
        retryable: false,
      },
      409
    );
  }
  const [collision] =
    await sql`SELECT id FROM tag WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND identity_key = ${identity} AND id <> ${operation.tagId}`;
  if (collision && !creating) {
    throw new PromptFailureError(
      {
        code: "name_conflict",
        message:
          "An equivalent tag already exists. Renaming requires an explicit tag merge, which is not available yet. Choose another name.",
        fields: {
          name: "This rename requires an explicit merge. Choose another name.",
        },
        retryable: false,
      },
      409
    );
  }
  const resolvedTagId: string = collision?.id ?? operation.tagId;
  let outcome = "renamed";
  if (creating) {
    outcome = collision ? "existing" : "created";
  }
  const delta = collision
    ? 0
    : utf8Bytes(name) - (creating ? 0 : utf8Bytes(current.name));
  const added = creating && !collision;
  await checkTagCapacity(sql, envelope, added, delta);
  const [accepted] =
    await sql`UPDATE library SET revision = revision + 1, text_bytes = text_bytes + ${delta}, tag_count = tag_count + ${added ? 1 : 0} WHERE instance_id = ${instanceId} AND account_id = ${accountId} RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
  if (added) {
    await sql`INSERT INTO tag(instance_id, account_id, id, name, identity_key, revision) VALUES (${instanceId}, ${accountId}, ${operation.tagId}, ${name}, ${identity}, ${accepted.revision})`;
  } else if (!creating && name !== current.name) {
    await sql`UPDATE tag SET name = ${name}, identity_key = ${identity}, revision = ${accepted.revision} WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${operation.tagId}`;
  }
  await sql`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, tag_id, resolved_tag_id, tag_outcome, revision, accepted_at) VALUES (${instanceId}, ${accountId}, ${operation.operationId}, ${envelope.epoch}, ${envelope.installationId}, 1, ${hash}, ${operation.kind}, ${operation.tagId}, ${resolvedTagId}, ${outcome}, ${accepted.revision}, ${accepted.accepted_at})`;
  await sql`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, tag_id, accepted_at) VALUES (${instanceId}, ${accountId}, ${accepted.revision}, ${operation.operationId}, ${operation.kind}, ${resolvedTagId}, ${accepted.accepted_at})`;
  return mutationResultSchema.parse({
    status: "accepted",
    operationId: operation.operationId,
    tagId: operation.tagId,
    resolvedTagId,
    outcome,
    revision: accepted.revision,
    acceptedAt: accepted.accepted_at.toISOString(),
  });
};

export const readTags = async (
  sql: SQL,
  scope: { instanceId: string; accountId: string }
): Promise<Tag[]> => {
  const rows = await sql`SELECT t.id, t.name, t.revision::text,
    count(p.id) FILTER (WHERE NOT p.archived)::int AS active_count,
    count(p.id) FILTER (WHERE p.archived)::int AS archived_count, count(p.id)::int AS total_count
    FROM tag t LEFT JOIN prompt_tag m ON m.instance_id = t.instance_id AND m.account_id = t.account_id AND m.tag_id = t.id AND m.add_revision > m.remove_revision
    LEFT JOIN prompt p ON p.instance_id = m.instance_id AND p.account_id = m.account_id AND p.id = m.prompt_id
    WHERE t.instance_id = ${scope.instanceId} AND t.account_id = ${scope.accountId} GROUP BY t.instance_id, t.account_id, t.id`;
  return rows
    .map(
      (row: {
        id: string;
        name: string;
        revision: string;
        active_count: number;
        archived_count: number;
        total_count: number;
      }) => ({
        id: row.id,
        name: row.name,
        revision: row.revision,
        activeCount: row.active_count,
        archivedCount: row.archived_count,
        totalCount: row.total_count,
      })
    )
    .toSorted(compareOrganizationNames);
};
