// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Shared cases consume complete REST pages sequentially.
import { expect, test } from "bun:test";

import { promptBrowseInputSchema } from "@pr0/api-contract/prompts";
import { SQL } from "bun";
import { z } from "zod";

import fixtures from "../../../packages/api-contract/src/search-order-fixtures.json";
import { collectionOperation } from "./collection-fixture";
import { promptBrowser, promptClient, promptOperation } from "./prompt-fixture";
import { tagOperation } from "./tag-fixture";

test("REST runs the identical native ordering, recency, filters and later-page fixtures", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const tags = [tagOperation("Organization 0"), tagOperation("Organization 1")];
  const collections = [
    collectionOperation("Organization 0"),
    collectionOperation("Organization 1"),
  ];
  await account.mutate([
    ...tags,
    ...collections,
    ...fixtures.prompts.map((fixture) => ({
      ...promptOperation({
        title: fixture.title,
        description: "",
        content: "needle",
      }),
      promptId: fixture.id,
      desired: {
        title: fixture.title,
        description: "",
        content: "needle",
        tagIds: fixture.tags.map((index) =>
          z.string().parse(tags[index]?.tagId)
        ),
        collectionId: collections[fixture.collection]?.collectionId,
      },
    })),
  ]);
  if (
    process.env.DATABASE_URL !==
    "postgres://pr0:local-social-test-only@localhost:55426/pr0"
  ) {
    throw new Error("Requires isolated fixture database");
  }
  const sql = new SQL(process.env.DATABASE_URL);
  try {
    // Fixture setup controls historical timestamps. All observations use public REST.
    for (const fixture of fixtures.prompts) {
      await sql`UPDATE prompt SET created_at=${new Date(fixture.createdAt)},modified_at=${new Date(fixture.modifiedAt)},last_used_at=${fixture.lastUsedAt ? new Date(fixture.lastUsedAt) : null},favorite=${fixture.favorite},archived=${fixture.archived} WHERE account_id=${account.identity.accountId} AND id=${fixture.id}`;
    }
  } finally {
    await sql.close();
  }
  for (const fixture of fixtures.cases) {
    const input = promptBrowseInputSchema.parse({
      query: "needle",
      sort: fixture.sort,
      view: fixture.view,
      limit: 2,
      favorite: fixture.favorite,
      collectionId:
        fixture.collection === undefined
          ? undefined
          : collections[fixture.collection]?.collectionId,
      viewCollectionId:
        fixture.viewCollection === undefined
          ? undefined
          : collections[fixture.viewCollection]?.collectionId,
      tagIds: fixture.tags?.map((index) =>
        z.string().parse(tags[index]?.tagId)
      ),
    });
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.getPrompts({ ...input, cursor });
      ids.push(...page.prompts.map((prompt) => prompt.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual(
      fixture.expected.map((index) =>
        z.string().parse(fixtures.prompts[index]?.id)
      )
    );
  }
}, 60_000);
