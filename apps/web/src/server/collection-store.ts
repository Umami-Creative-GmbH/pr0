// oxlint-disable react-doctor/server-sequential-independent-await -- Changes and receipt commit inside the caller's serialized library transaction.
import "server-only";
import {
  compareOrganizationNames,
  organizationIdentity,
  organizationNameSchema,
  trimOrganizationName,
} from "@pr0/api-contract/organization";
import {
  collectionReceiptSchema,
  organizationSnapshotSchema,
  promptLimits,
  utf8Bytes,
} from "@pr0/api-contract/prompts";
import type {
  CollectionOperation,
  MutationEnvelope,
  UpdatePrompt,
} from "@pr0/api-contract/prompts";
import type { SQL } from "bun";

import { PromptFailureError } from "./prompt-errors";

export const validateCollectionReference = async (
  sql: SQL,
  scope: { instanceId: string; accountId: string },
  id: string | null | undefined
) => {
  if (!id) {
    return;
  }
  const [collection] =
    await sql`SELECT id FROM collection WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} AND id = ${id}`;
  if (!collection) {
    throw new PromptFailureError({
      code: "validation_failed",
      message: "Choose an available collection in this library.",
      fields: {
        collectionId: "This collection is not available in your library.",
      },
      retryable: false,
    });
  }
};

export const reconcileCollectionAssignment = async (
  sql: SQL,
  envelope: MutationEnvelope,
  operation: UpdatePrompt,
  current: { collection_id: string | null; collection_revision: string }
) => {
  const changed = operation.changedFields.includes("collectionId");
  const collectionId = changed
    ? (operation.desired.collectionId ?? null)
    : current.collection_id;
  const copyCollectionId =
    operation.desired.collectionId === undefined
      ? current.collection_id
      : operation.desired.collectionId;
  await validateCollectionReference(sql, envelope, copyCollectionId);
  const superseded =
    changed &&
    current.collection_id !== collectionId &&
    current.collection_id !== operation.base.collectionId &&
    BigInt(current.collection_revision) > BigInt(operation.baseRevision);
  return {
    collectionId,
    copyCollectionId,
    organizationNotice: superseded
      ? "A concurrent collection assignment was superseded by this saved choice."
      : null,
  };
};
export const applyCollection = async (
  sql: SQL,
  envelope: MutationEnvelope,
  operation: CollectionOperation,
  hash: string
) => {
  const { instanceId, accountId } = envelope;
  const parsed = organizationNameSchema.safeParse(operation.name);
  if (!parsed.success) {
    throw new PromptFailureError({
      code: "validation_failed",
      message: "Correct the collection name.",
      fields: { name: parsed.error.issues[0]?.message ?? "Invalid name." },
      retryable: false,
    });
  }
  const name = trimOrganizationName(parsed.data);
  const identity = organizationIdentity(name);
  const [current] =
    await sql`SELECT name FROM collection WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${operation.collectionId}`;
  if (operation.kind === "collection.rename" && !current) {
    throw new PromptFailureError(
      {
        code: "not_found",
        message: "This collection is not available in your library.",
        retryable: false,
      },
      404
    );
  }
  const [used] =
    await sql`SELECT operation_id FROM library_operation WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND (collection_id = ${operation.collectionId} OR prompt_id = ${operation.collectionId} OR conflict_copy_id = ${operation.collectionId}) LIMIT 1`;
  if (operation.kind === "collection.create" && (current || used)) {
    throw new PromptFailureError(
      {
        code: "identity_unavailable",
        message: "This collection identity has already been used.",
        retryable: false,
      },
      409
    );
  }
  const [collision] =
    await sql`SELECT id FROM collection WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND identity_key = ${identity} AND id <> ${operation.collectionId}`;
  if (collision) {
    throw new PromptFailureError(
      {
        code: "name_conflict",
        message:
          "A collection with an equivalent name already exists. Choose another name.",
        fields: {
          name: "A collection with an equivalent name already exists.",
        },
        retryable: false,
      },
      409
    );
  }
  const creating = operation.kind === "collection.create";
  const delta = utf8Bytes(name) - (creating ? 0 : utf8Bytes(current.name));
  const [library] =
    await sql`SELECT collection_count, text_bytes::text FROM library WHERE instance_id = ${instanceId} AND account_id = ${accountId}`;
  const countExceeded = creating && library.collection_count >= 200;
  if (
    countExceeded ||
    (delta > 0 &&
      Number(library.text_bytes) + delta > promptLimits.libraryBytes)
  ) {
    throw new PromptFailureError({
      code: "quota_exceeded",
      resource: countExceeded ? "collectionCount" : "textBytes",
      message: countExceeded
        ? "Your library has reached 200 collections. Rename existing collections or free a slot before creating another."
        : "This name would exceed the library's 100 MiB text capacity. Shorten the name or free text capacity.",
      retryable: true,
    });
  }
  const [accepted] =
    await sql`UPDATE library SET revision = revision + 1, text_bytes = text_bytes + ${delta}, collection_count = collection_count + ${creating ? 1 : 0}
    WHERE instance_id = ${instanceId} AND account_id = ${accountId} RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
  if (creating) {
    await sql`INSERT INTO collection(instance_id, account_id, id, name, identity_key, revision) VALUES (${instanceId}, ${accountId}, ${operation.collectionId}, ${name}, ${identity}, ${accepted.revision})`;
  } else if (name !== current.name) {
    await sql`UPDATE collection SET name = ${name}, identity_key = ${identity}, revision = ${accepted.revision} WHERE instance_id = ${instanceId} AND account_id = ${accountId} AND id = ${operation.collectionId}`;
  }
  await sql`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, collection_id, revision, accepted_at)
    VALUES (${instanceId}, ${accountId}, ${operation.operationId}, ${envelope.epoch}, ${envelope.installationId}, 1, ${hash}, ${operation.kind}, ${operation.collectionId}, ${accepted.revision}, ${accepted.accepted_at})`;
  await sql`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, collection_id, accepted_at)
    VALUES (${instanceId}, ${accountId}, ${accepted.revision}, ${operation.operationId}, ${operation.kind}, ${operation.collectionId}, ${accepted.accepted_at})`;
  return collectionReceiptSchema.parse({
    status: "accepted",
    operationId: operation.operationId,
    collectionId: operation.collectionId,
    revision: accepted.revision,
    acceptedAt: accepted.accepted_at.toISOString(),
  });
};

export const readOrganization = async (
  sql: SQL,
  scope: {
    instanceId: string;
    accountId: string;
    revision: string;
    textBytes: number;
  }
) => {
  const rows = await sql`SELECT c.id, c.name, c.revision::text,
    count(p.id) FILTER (WHERE NOT p.archived)::int AS active_count,
    count(p.id) FILTER (WHERE p.archived)::int AS archived_count, count(p.id)::int AS total_count
    FROM collection c LEFT JOIN prompt p ON p.instance_id = c.instance_id AND p.account_id = c.account_id AND p.collection_id = c.id
    WHERE c.instance_id = ${scope.instanceId} AND c.account_id = ${scope.accountId}
    GROUP BY c.instance_id, c.account_id, c.id`;
  const snapshot = organizationSnapshotSchema.parse({
    ...scope,
    collections: rows.map(
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
    ),
  });
  snapshot.collections.sort(compareOrganizationNames);
  return snapshot;
};
