import type {
  AssignTags,
  LibraryScope,
  TagOperation,
} from "@pr0/api-contract/prompts";
import { SQL } from "bun";

export const tagOperation = (name: string, tagId?: string): TagOperation => ({
  kind: tagId ? "tag.rename" : "tag.create",
  operationId: crypto.randomUUID(),
  tagId: tagId ?? crypto.randomUUID(),
  name,
  baseRevision: "0",
  dependsOn: [],
});
export const tagDelta = (
  promptId: string,
  baseRevision: string,
  add: string[],
  remove: string[] = []
): AssignTags => ({
  kind: "prompt.tags",
  operationId: crypto.randomUUID(),
  promptId,
  baseRevision,
  add,
  remove,
  dependsOn: [],
});

// External persisted fixture; observe all results through REST or browser behavior.
export const seedTags = async (scope: LibraryScope, count: number) => {
  const url = process.env.DATABASE_URL;
  if (
    url !== "postgres://pr0:local-social-test-only@localhost:55426/pr0" &&
    url !== "postgres://pr0:local-deletion-test-only@localhost:55456/pr0"
  ) {
    throw new Error("Tag fixture requires the isolated test database");
  }
  const sql = new SQL(url);
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT account_id FROM library WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} FOR UPDATE`;
      await tx`INSERT INTO tag(instance_id, account_id, id, name, identity_key, revision) SELECT ${scope.instanceId}::uuid, ${scope.accountId}, gen_random_uuid(), 'Tag ' || lpad(n::text, 4, '0'), 'tag ' || lpad(n::text, 4, '0'), n FROM generate_series(1, ${count}::int) n`;
      await tx`UPDATE library SET tag_count = ${count}, revision = revision + ${count}, text_bytes = text_bytes + ${count * 8} WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId}`;
    });
  } finally {
    await sql.close();
  }
};
