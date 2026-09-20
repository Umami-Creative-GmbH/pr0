// oxlint-disable react-doctor/server-sequential-independent-await -- Resolution uses the mutation's locked library snapshot.
import "server-only";
import type { LibraryScope } from "@pr0/api-contract/prompts";
import type { SQL } from "bun";

import { PromptFailureError } from "./prompt-errors";

export const resolveTagReferences = async (
  sql: SQL,
  scope: LibraryScope,
  ids: string[]
) => {
  if (!ids.length) {
    return { ids: [], adjusted: false, paths: new Map<string, string[]>() };
  }
  const rows = await sql`WITH RECURSIVE chain AS (
    SELECT id AS root, id FROM unnest(string_to_array(${ids.join(",")}, ',')::uuid[]) AS requested(id)
    UNION ALL SELECT c.root, r.target_id FROM chain c JOIN organization_removed r ON r.instance_id = ${scope.instanceId} AND r.account_id = ${scope.accountId} AND r.id = c.id AND r.entity = 'tag' WHERE r.target_id IS NOT NULL
    ) CYCLE id SET cycle USING path
    SELECT c.root, c.id, c.cycle, t.id AS live_id, r.id AS removed_id FROM chain c
    LEFT JOIN tag t ON t.instance_id = ${scope.instanceId} AND t.account_id = ${scope.accountId} AND t.id = c.id
    LEFT JOIN organization_removed r ON r.instance_id = ${scope.instanceId} AND r.account_id = ${scope.accountId} AND r.id = c.id AND r.entity = 'tag'`;
  if (
    rows.some(
      (row: (typeof rows)[number]) =>
        row.cycle || (!row.live_id && !row.removed_id)
    )
  ) {
    throw new PromptFailureError({
      code: "validation_failed",
      message: "Choose available tags in this library.",
      fields: { tagIds: "A tag is not available in your library." },
      retryable: false,
    });
  }
  const resolved: string[] = [
    ...new Set<string>(
      rows.flatMap((row: (typeof rows)[number]) =>
        row.live_id ? [row.live_id] : []
      )
    ),
  ];
  const resolvedSet = new Set(resolved);
  const paths = new Map<string, string[]>();
  for (const row of rows) {
    const path = paths.get(row.root) ?? [];
    path.push(row.id);
    paths.set(row.root, path);
  }
  return {
    ids: resolved,
    adjusted: ids.some((id) => !resolvedSet.has(id)),
    paths,
  };
};
