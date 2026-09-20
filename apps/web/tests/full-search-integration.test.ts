// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Public REST journeys apply changes and consume pages in order.
import { expect, test } from "bun:test";

import {
  relevanceFixtures,
  textSearchFixtures,
} from "@pr0/api-contract/search-fixtures";

import { collectionOperation } from "./collection-fixture";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptState,
} from "./prompt-fixture";
import { tagOperation } from "./tag-fixture";

const resultIds = async (
  client: ReturnType<typeof promptClient>,
  input: Parameters<typeof client.getPrompts>[0]
) => {
  const page = await client.getPrompts(input);
  return page.prompts.map((row) => row.id);
};
const rawResultIds = async (
  account: Awaited<ReturnType<typeof promptBrowser>>,
  params: URLSearchParams
) => {
  const response = await account.get(`?${params}`);
  expect(response.status).toBe(200);
  const page = await response.json();
  return page.prompts.map((row: { id: string }) => row.id);
};

test("canonical six tiers qualify all five fields and page in relevance order", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const tag = tagOperation("German");
  const collection = collectionOperation("German");
  await account.mutate([tag, collection]);
  const operations = relevanceFixtures.map((fixture) => ({
    ...promptOperation({
      title: fixture.title,
      description: fixture.description,
      content: fixture.content,
    }),
    desired: {
      title: fixture.title,
      description: fixture.description,
      content: fixture.content,
      tagIds: fixture.tag ? [tag.tagId] : [],
      collectionId: fixture.collection ? collection.collectionId : null,
    },
  }));
  await account.mutate([
    ...operations,
    promptOperation({ title: "German only", description: "", content: "body" }),
  ]);
  const titles: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.getPrompts({
      query: "German email",
      limit: 2,
      cursor,
    });
    titles.push(...page.prompts.map((prompt) => prompt.title));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(titles).toEqual([
    "German email",
    "Email templates in German",
    "Email reply",
    "Reply template",
    "Response template",
    "Translation helper",
  ]);
});

test.each([...textSearchFixtures])(
  "tag and collection names preserve literal semantics: $query in $text",
  async ({ query, text, matches }) => {
    const account = await promptBrowser();
    const client = promptClient(account.Cookie);
    const tag = tagOperation(text);
    const collection = collectionOperation(text);
    const tagged = promptOperation({
      title: "Fixture",
      description: "",
      content: "body",
    });
    const grouped = promptOperation({
      title: "Fixture",
      description: "",
      content: "body",
    });
    await account.mutate([
      tag,
      collection,
      { ...tagged, desired: { ...tagged.desired, tagIds: [tag.tagId] } },
      {
        ...grouped,
        desired: { ...grouped.desired, collectionId: collection.collectionId },
      },
    ]);
    const page = await client.getPrompts({ query });
    expect(new Set(page.prompts.map((row) => row.id))).toEqual(
      new Set(matches ? [tagged.promptId, grouped.promptId] : [])
    );
  }
);

test("cursor binds full filter scope and organization revisions, with strict request validation", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const collection = collectionOperation("Marketing");
  await account.mutate([
    collection,
    ...Array.from({ length: 3 }, () => {
      const prompt = promptOperation();
      return {
        ...prompt,
        desired: { ...prompt.desired, collectionId: collection.collectionId },
      };
    }),
  ]);
  const first = await client.getPrompts({
    query: "marketing",
    view: "collection",
    viewCollectionId: collection.collectionId,
    favorite: false,
    limit: 1,
  });
  expect(first.prompts).toHaveLength(1);
  expect(first.nextCursor).not.toBeNull();
  await expect(
    client.getPrompts({
      query: "marketing",
      view: "collection",
      viewCollectionId: collection.collectionId,
      favorite: true,
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    })
  ).rejects.toHaveProperty("status", 400);
  const other = await promptBrowser();
  const foreign = await promptClient(other.Cookie).getPrompts({
    query: "marketing",
    collectionId: collection.collectionId,
  });
  expect(foreign.prompts).toEqual([]);
  const organization = await client.getOrganization();
  await account.mutate([
    {
      ...collectionOperation("Market", collection.collectionId),
      baseRevision: organization.revision,
    },
  ]);
  await expect(
    client.getPrompts({
      query: "marketing",
      view: "collection",
      viewCollectionId: collection.collectionId,
      favorite: false,
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    })
  ).rejects.toHaveProperty("status", 409);
  for (const query of [
    "favorite=1",
    "favorite=yes",
    "view=collection",
    `view=archive&viewCollectionId=${collection.collectionId}`,
    "favorite=true&favorite=false",
  ]) {
    const response = await account.get(`?${query}`);
    expect(response.status).toBe(400);
  }
});

test("organization rename updates search without body updates and deletion never substitutes equal names", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const collection = collectionOperation("Marketing");
  const tag = tagOperation("Café Straße");
  const create = promptOperation({
    title: "Reply",
    description: "",
    content: "body",
  });
  await account.mutate([
    collection,
    tag,
    {
      ...create,
      desired: {
        ...create.desired,
        collectionId: collection.collectionId,
        tagIds: [tag.tagId],
      },
    },
  ]);
  const before = await client.getPrompt(create.promptId);
  expect(await resultIds(client, { query: "cafe strasse marketing" })).toEqual([
    create.promptId,
  ]);
  const rename = {
    ...tagOperation("Über", tag.tagId),
    baseRevision: before.libraryRevision ?? before.revision,
  };
  await account.mutate([rename]);
  const renamed = await account.get("?query=uber");
  expect(renamed.headers.get("Server-Timing")).toContain(
    'search-updates;desc="0"'
  );
  expect(renamed.headers.get("Server-Timing")).toContain(
    'search-bytes;desc="0"'
  );
  const renamedPage = await renamed.json();
  expect(renamedPage.prompts.map((row: { id: string }) => row.id)).toEqual([
    create.promptId,
  ]);
  const afterRename = await client.getPrompt(create.promptId);
  expect(afterRename.modifiedAt).toBe(before.modifiedAt);
  expect(await resultIds(client, { query: "cafe" })).toEqual([]);
  const organization = await client.getOrganization();
  await account.mutate([
    {
      kind: "tag.delete",
      operationId: crypto.randomUUID(),
      tagId: tag.tagId,
      baseRevision: organization.revision,
      dependsOn: [],
    },
  ]);
  const replacement = tagOperation("Über");
  await account.mutate([replacement]);
  expect(await resultIds(client, { tagIds: [tag.tagId] })).toEqual([]);
  expect(await resultIds(client, { query: "uber" })).toEqual([]);
  const changed = await client.getPrompt(create.promptId);
  const renamedCollection = {
    ...collectionOperation("Sales", collection.collectionId),
    baseRevision: changed.libraryRevision ?? changed.revision,
  };
  await account.mutate([renamedCollection]);
  expect(await resultIds(client, { query: "marketing" })).toEqual([]);
  expect(await resultIds(client, { query: "sales" })).toEqual([
    create.promptId,
  ]);
});

test("collection scope, optional collection, every tag and favorite combine with text and archive isolation", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const work = collectionOperation("Work");
  const other = collectionOperation("Other");
  const writing = tagOperation("Writing");
  const german = tagOperation("German");
  await account.mutate([work, other, writing, german]);
  const create = promptOperation({
    title: "Reply",
    description: "",
    content: "summarize",
  });
  create.desired = {
    ...create.desired,
    collectionId: work.collectionId,
    tagIds: [writing.tagId, german.tagId],
  };
  await account.mutate([create]);
  const base = await client.getPrompt(create.promptId);
  await account.mutate([promptState(base, "favorite", true)]);
  const params = new URLSearchParams({
    view: "collection",
    viewCollectionId: work.collectionId,
    collectionId: work.collectionId,
    tagIds: `${writing.tagId},${german.tagId}`,
    favorite: "true",
    query: "summ German",
  });
  const match = await account.get(`?${params}`);
  expect(match.status).toBe(200);
  const matchingPage = await match.json();
  expect(matchingPage.prompts.map((row: { id: string }) => row.id)).toEqual([
    create.promptId,
  ]);
  params.set("collectionId", other.collectionId);
  expect(await rawResultIds(account, params)).toEqual([]);
  const favorite = await client.getPrompt(create.promptId);
  await account.mutate([promptState(favorite, "archived", true)]);
  params.set("collectionId", work.collectionId);
  expect(await rawResultIds(account, params)).toEqual([]);
  params.set("view", "archive");
  params.delete("viewCollectionId");
  expect(await rawResultIds(account, params)).toEqual([create.promptId]);
});
