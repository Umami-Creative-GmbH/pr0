import type {
  CollectionOperation,
  Prompt,
  UpdatePrompt,
  LibraryScope,
} from "@pr0/api-contract/prompts";
import { SQL } from "bun";

import { promptEdit } from "./prompt-fixture";

// External persisted-library fixture; all assertions use the public REST boundary.
export const seedCollections = async (scope: LibraryScope, count: number) => {
  const url = process.env.DATABASE_URL;
  if (
    url !== "postgres://pr0:local-social-test-only@localhost:55426/pr0" &&
    url !== "postgres://pr0:local-deletion-test-only@localhost:55456/pr0"
  ) {
    throw new Error("Collection fixture requires the isolated test database");
  }
  const sql = new SQL(url);
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT account_id FROM library WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} FOR UPDATE`;
      await tx`INSERT INTO collection(instance_id, account_id, id, name, identity_key, revision)
        SELECT ${scope.instanceId}::uuid, ${scope.accountId}, gen_random_uuid(), 'Collection ' || lpad(n::text, 3, '0'), 'collection ' || lpad(n::text, 3, '0'), n FROM generate_series(1, ${count}::int) n`;
      await tx`UPDATE library SET collection_count = ${count}, revision = revision + ${count}, text_bytes = text_bytes + ${count * 14} WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId}`;
    });
  } finally {
    await sql.close();
  }
};

export const collectionOperation = (
  name: string,
  collectionId?: string
): CollectionOperation => ({
  kind: collectionId ? "collection.rename" : "collection.create",
  operationId: crypto.randomUUID(),
  collectionId: collectionId ?? crypto.randomUUID(),
  baseRevision: "0",
  dependsOn: [],
  name,
});
export const assignCollection = (
  prompt: Prompt,
  collectionId: string | null
): UpdatePrompt => ({
  ...promptEdit(prompt, {
    title: prompt.title,
    description: prompt.description,
    content: prompt.content,
  }),
  base: {
    title: prompt.title,
    description: prompt.description,
    content: prompt.content,
    collectionId: prompt.collectionId,
  },
  desired: {
    title: prompt.title,
    description: prompt.description,
    content: prompt.content,
    collectionId,
  },
  changedFields: prompt.collectionId === collectionId ? [] : ["collectionId"],
});
