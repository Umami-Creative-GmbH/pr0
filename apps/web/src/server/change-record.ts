// oxlint-disable react-doctor/server-sequential-independent-await -- Capture canonical effects under the mutation's library lock.
import "server-only";
import { changeEventSchema, changeLimits } from "@pr0/api-contract/changes";
import type {
  MutationEnvelope,
  MutationResult,
} from "@pr0/api-contract/prompts";
import type { SQL } from "bun";

import { readOrganization } from "./collection-store";

interface ChangedPrompt {
  id: string;
  title: string;
  description: string;
  content: string;
  source_title: string | null;
  revision: string;
  created_at: Date;
  modified_at: Date;
  favorite: boolean;
  archived: boolean;
  collection_id: string | null;
  tag_ids: string[];
  use_count: number;
  last_used_at: Date | null;
}

export const captureChange = async (
  sql: SQL,
  scope: MutationEnvelope,
  receipt: MutationResult
) => {
  if (receipt.status !== "accepted") {
    return;
  }
  const { instanceId, accountId } = scope;
  const [change] =
    await sql`SELECT organization_effect, accepted_at FROM library_change WHERE instance_id=${instanceId} AND account_id=${accountId} AND revision=${receipt.revision}::bigint AND operation_id=${receipt.operationId}`;
  // Acknowledged no-ops can reuse a previous revision without creating a change.
  if (!change) {
    return;
  }
  const [library] =
    await sql`SELECT text_bytes::text FROM library WHERE instance_id=${instanceId} AND account_id=${accountId}`;
  const organization = await readOrganization(sql, {
    instanceId,
    accountId,
    revision: receipt.revision,
    textBytes: Number(library.text_bytes),
  });
  const rows: ChangedPrompt[] = change.organization_effect
    ? []
    : await sql`SELECT p.id,p.title,p.description,p.content,p.source_title,p.revision::text,p.created_at,p.modified_at,p.favorite,p.archived,p.collection_id,p.use_count,p.last_used_at,
    ARRAY(SELECT tag_id::text FROM prompt_tag t WHERE t.instance_id=p.instance_id AND t.account_id=p.account_id AND t.prompt_id=p.id AND t.add_revision>t.remove_revision ORDER BY tag_id) AS tag_ids
    FROM prompt p WHERE p.instance_id=${instanceId} AND p.account_id=${accountId} AND p.revision=${receipt.revision}::bigint ORDER BY p.id LIMIT 3`;
  const deleted =
    await sql`SELECT prompt_id FROM prompt_deletion WHERE instance_id=${instanceId} AND account_id=${accountId} AND revision=${receipt.revision}::bigint`;
  const event = changeEventSchema.parse({
    revision: receipt.revision,
    operationId: receipt.operationId,
    acceptedAt: change.accepted_at.toISOString(),
    organization,
    effect: change.organization_effect,
    deletedPromptIds: deleted.map(
      (row: { prompt_id: string }) => row.prompt_id
    ),
    prompts: rows.map((row) => ({
      instanceId,
      accountId,
      id: row.id,
      title: row.title,
      description: row.description,
      content: row.content,
      sourceTitle: row.source_title,
      revision: row.revision,
      createdAt: row.created_at.toISOString(),
      modifiedAt: row.modified_at.toISOString(),
      favorite: row.favorite,
      archived: row.archived,
      collectionId: row.collection_id,
      tagIds: row.tag_ids,
      useCount: Number(row.use_count),
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
    })),
  });
  const payload = JSON.stringify(event);
  if (Buffer.byteLength(payload) > changeLimits.pageBytes - 4096) {
    throw new Error("Change exceeds page limit");
  }
  await sql`UPDATE library_change SET payload=${payload} WHERE instance_id=${instanceId} AND account_id=${accountId} AND revision=${receipt.revision}::bigint`;
  // Notifications contain ownership only, and PostgreSQL delivers them after commit.
  await sql`SELECT pg_notify('pr0_library_change', ${`${instanceId}:${accountId}`})`;
};
