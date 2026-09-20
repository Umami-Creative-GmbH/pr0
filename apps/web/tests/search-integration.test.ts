// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Mutations, sorted pages, and cancellation checks exercise one stateful REST journey in order.
import { expect, test } from "bun:test";

import { textSearchFixtures } from "@pr0/api-contract/search-fixtures";
import { SQL } from "bun";

import {
  promptBrowser,
  promptOperation,
  promptClient,
  promptEdit,
  promptDeletion,
} from "./prompt-fixture";

test("literal search qualifies every term across text fields and ranks exact title first", async () => {
  const account = await promptBrowser();
  const texts = [
    {
      title: "Translation helper",
      description: "",
      content: "German email ".repeat(50),
    },
    {
      title: "Response template",
      description: "German email",
      content: "body",
    },
    { title: "Email reply", description: "", content: "German" },
    { title: "Email templates in German", description: "", content: "body" },
    { title: "German email", description: "", content: "body" },
    { title: "German only", description: "", content: "body" },
  ];
  const created = await account.mutate(texts.map(promptOperation));
  expect(created.status).toBe(200);
  const response = await account.get("?query=German%20email");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.prompts.map((row: { title: string }) => row.title)).toEqual([
    "German email",
    "Email templates in German",
    "Email reply",
    "Response template",
    "Translation helper",
  ]);
  expect(
    body.prompts.every((row: { title: string }) => !("content" in row))
  ).toBe(true);
});

test("all explicit sorts and relevance use scalar title and UUID tie breaks", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const titles = ["\uE000", "𐀀", "Same", "Same"];
  const ids = [
    "00000000-0000-4000-8000-000000000004",
    "00000000-0000-4000-8000-000000000003",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000001",
  ] as const;
  await account.mutate(
    titles.map((title, index) => ({
      ...promptOperation({ title, description: "", content: "needle" }),
      promptId: ids[index] ?? crypto.randomUUID(),
    }))
  );
  if (
    process.env.DATABASE_URL !==
    "postgres://pr0:local-social-test-only@localhost:55426/pr0"
  ) {
    throw new Error("Requires isolated fixture database");
  }
  const sql = new SQL(process.env.DATABASE_URL);
  try {
    for (const [index, id] of ids.entries()) {
      const created = new Date(`2026-01-0${index + 1}T00:00:00Z`);
      const modified = new Date(
        `2026-01-0${index === 2 ? 5 : index + 1}T00:00:00Z`
      );
      await sql`UPDATE prompt SET created_at=${created},modified_at=${modified},last_used_at=${index >= 2 ? new Date("2026-01-06T00:00:00Z") : null} WHERE account_id=${account.identity.accountId} AND id=${id}`;
    }
  } finally {
    await sql.close();
  }
  const sorts = [
    ["relevance", [2, 3, 1, 0]],
    ["title", [3, 2, 0, 1]],
    ["recently-used", [3, 2, 1, 0]],
    ["recently-modified", [2, 3, 1, 0]],
    ["newest", [3, 2, 1, 0]],
    ["oldest", [0, 1, 2, 3]],
  ] as const;
  for (const [sort, expected] of sorts) {
    const page = await client.getPrompts({ query: "needle", sort });
    expect(page.prompts.map((row) => row.id)).toEqual(
      expected.map((index) => ids[index])
    );
  }
  const controller = new AbortController();
  controller.abort();
  await expect(
    client.getPrompts({ query: "needle" }, controller.signal)
  ).rejects.toHaveProperty("name", "AbortError");
  const afterCancel = await client.getPrompts({ query: "needle" });
  expect(afterCancel.prompts).toHaveLength(4);
});

test("ordered exact verification reaches matches after multiple false-positive batches", async () => {
  const account = await promptBrowser();
  const operations = Array.from({ length: 151 }, (_, index) =>
    promptOperation({
      title: `Body ${String(index).padStart(3, "0")}`,
      description: "",
      content: index === 150 ? "abcd" : "abc bcd",
    })
  );
  for (const batch of [operations.slice(0, 100), operations.slice(100)]) {
    await account.mutate(batch);
  }
  const page = await promptClient(account.Cookie).getPrompts({
    query: "abcd",
    sort: "title",
  });
  expect(page.prompts.map((row) => row.title)).toEqual(["Body 150"]);
});

test.each([...textSearchFixtures])(
  "literal Unicode search: $query in $text",
  async ({ query, text, matches }) => {
    const account = await promptBrowser();
    const operation = promptOperation({
      title: "Fixture",
      description: "",
      content: text,
    });
    await account.mutate([operation]);
    const response = await account.get(`?query=${encodeURIComponent(query)}`);
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.prompts.map((row: { id: string }) => row.id)).toEqual(
      matches ? [operation.promptId] : []
    );
    const saved = await promptClient(account.Cookie).getPrompt(
      operation.promptId
    );
    expect(saved.content).toBe(text);
  }
);

test("REST rejects malformed and over-limit queries before normalization", async () => {
  const account = await promptBrowser();
  for (const query of [
    encodeURIComponent("🌍".repeat(201)),
    "%00",
    "%ED%A0%80",
    "%FF",
    "%",
    "a&query=b",
  ]) {
    const response = await account.get(`?query=${query}`);
    expect({ query, status: response.status }).toEqual({ query, status: 400 });
    expect(await response.json()).toMatchObject({ code: "validation_failed" });
  }
  const boundary = await account.get(
    `?query=${encodeURIComponent("🌍".repeat(200))}`
  );
  expect(boundary.status).toBe(200);
});

test("later pages remain reachable and cursors bind ordering and revision", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const operations = Array.from({ length: 125 }, (_, index) =>
    promptOperation({
      title: `Result ${String(index).padStart(3, "0")}`,
      description: "",
      content: "needle",
    })
  );
  for (const batch of [operations.slice(0, 100), operations.slice(100)]) {
    await account.mutate(batch);
  }
  const first = await client.getPrompts({ query: "needle", sort: "title" });
  expect(first.prompts).toHaveLength(50);
  const second = await client.getPrompts({
    query: "needle",
    sort: "title",
    cursor: first.nextCursor ?? undefined,
  });
  const third = await client.getPrompts({
    query: "needle",
    sort: "title",
    cursor: second.nextCursor ?? undefined,
  });
  expect(
    [...first.prompts, ...second.prompts, ...third.prompts].map((row) => row.id)
  ).toEqual(operations.map((row) => row.promptId));
  expect(third.nextCursor).toBeNull();
  const mismatched = await account.get(
    `?query=other&sort=title&cursor=${first.nextCursor}`
  );
  expect(mismatched.status).toBe(400);
  const [operation] = operations;
  if (!operation) {
    throw new Error("Missing fixture");
  }
  const base = await client.getPrompt(operation.promptId);
  await account.mutate([
    promptEdit(base, {
      title: base.title,
      description: "",
      content: "no longer matches",
    }),
  ]);
  const changed = await account.get(
    `?query=needle&sort=title&cursor=${first.nextCursor}`
  );
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({ code: "results_changed" });
  const refreshed = await client.getPrompts({ query: "needle", sort: "title" });
  expect(refreshed.prompts[0]?.title).toBe("Result 001");
  await account.mutate([
    promptDeletion(await client.getPrompt(operation.promptId)),
  ]);
  const afterDelete = await client.getPrompts({ query: "no longer matches" });
  expect(afterDelete.prompts).toHaveLength(0);
});
