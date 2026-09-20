import { expect, test } from "bun:test";

import { duplicatePromptFixtures } from "@pr0/api-contract/prompt-fixtures";
import type { DuplicatePrompt } from "@pr0/api-contract/prompts";

import { post } from "./http-fixture";
import { seedCapacity } from "./prompt-capacity-fixture";
import {
  promptBrowser,
  promptClient,
  promptEdit,
  promptOperation,
  promptState,
} from "./prompt-fixture";
import { seedPromptUsage } from "./prompt-lifecycle-fixture";

test("favorite and archive changes retain text, combine with stale edits, and replay once", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  await account.mutate([create]);
  const base = await client.getPrompt(create.promptId);
  const favorite = {
    ...promptEdit(base, create.desired),
    base: { ...create.desired, favorite: false },
    desired: { ...create.desired, favorite: true },
    changedFields: ["favorite"],
  };
  const response = await post(
    "/api/v1/sync/mutations",
    { ...account.identity, operations: [favorite] },
    { Cookie: account.Cookie }
  );
  expect(await response.json()).toMatchObject({
    results: [{ status: "accepted" }],
  });
  const favored = await client.getPrompt(base.id);
  expect(favored.favorite).toBe(true);
  expect(favored.modifiedAt > base.modifiedAt).toBe(true);
  const archive = {
    ...promptEdit(base, create.desired),
    base: { ...create.desired, archived: false },
    desired: { ...create.desired, archived: true },
    changedFields: ["archived"],
  };
  const archivedResponse = await post(
    "/api/v1/sync/mutations",
    { ...account.identity, operations: [archive] },
    { Cookie: account.Cookie }
  );
  const receipt = await archivedResponse.json();
  expect(receipt).toMatchObject({ results: [{ status: "accepted" }] });
  const replay = await post(
    "/api/v1/sync/mutations",
    { ...account.identity, operations: [archive] },
    { Cookie: account.Cookie }
  );
  expect(await replay.json()).toEqual(receipt);
  await client.mutatePrompts({
    ...account.identity,
    operations: [
      promptEdit(base, { ...create.desired, content: "Edited while archived" }),
    ],
  });
  expect(await client.getPrompt(base.id)).toMatchObject({
    favorite: true,
    archived: true,
    content: "Edited while archived",
  });
  expect(await client.getPrompts()).toMatchObject({ prompts: [] });
});

test("duplication captures the selected archived favorite snapshot with an independent identity", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  await account.mutate([create]);
  const base = await client.getPrompt(create.promptId);
  const state = promptEdit(base, create.desired);
  state.base = { ...state.base, favorite: false, archived: false };
  state.desired = { ...state.desired, favorite: true, archived: true };
  state.changedFields = ["favorite", "archived"];
  await account.mutate([state]);
  const source = await client.getPrompt(base.id);
  const duplicate = {
    ...promptOperation(create.desired),
    kind: "prompt.duplicate",
    sourceId: base.id,
  };
  await account.mutate([
    promptEdit(source, { ...create.desired, content: "Later source" }),
  ]);
  const envelope = { ...account.identity, operations: [duplicate] };
  const response = await post("/api/v1/sync/mutations", envelope, {
    Cookie: account.Cookie,
  });
  const receipt = await response.json();
  expect(receipt).toMatchObject({
    results: [{ status: "accepted", promptId: duplicate.promptId }],
  });
  const replay = await post("/api/v1/sync/mutations", envelope, {
    Cookie: account.Cookie,
  });
  expect(await replay.json()).toEqual(receipt);
  const copy = await client.getPrompt(duplicate.promptId);
  expect(copy).toMatchObject({
    title: "Writing helper (copy)",
    content: "Hello",
    favorite: false,
    archived: false,
    useCount: 0,
    lastUsedAt: null,
  });
  expect(receipt).toMatchObject({ results: [{ acceptedAt: copy.createdAt }] });
  expect(copy.modifiedAt).toBe(copy.createdAt);
  expect(await client.getPrompt(base.id)).toMatchObject({
    favorite: true,
    archived: true,
    content: "Later source",
  });
  const archived = await account.get("?view=archive&limit=1");
  expect(await archived.json()).toMatchObject({ prompts: [{ id: base.id }] });
  const favorites = await account.get("?view=favorites");
  expect(await favorites.json()).toMatchObject({ prompts: [] });
  const restore = promptEdit(source, {
    title: source.title,
    description: source.description,
    content: source.content,
  });
  restore.base.archived = true;
  restore.desired.archived = false;
  restore.changedFields = ["archived"];
  await account.mutate([restore]);
  const restored = await account.get("?view=favorites");
  expect(await restored.json()).toMatchObject({
    prompts: [{ id: base.id, favorite: true, archived: false }],
  });
});

test.each([...duplicatePromptFixtures])(
  "duplicate retains exact snapshot and full title: $title",
  async (fixture) => {
    const account = await promptBrowser();
    const client = promptClient(account.Cookie);
    const create = promptOperation({
      title: fixture.sourceTitle,
      description: fixture.description,
      content: fixture.content,
    });
    await account.mutate([create]);
    const duplicate: DuplicatePrompt = {
      ...promptOperation(create.desired),
      kind: "prompt.duplicate",
      sourceId: create.promptId,
    };
    expect(
      await client.mutatePrompts({
        ...account.identity,
        operations: [duplicate],
      })
    ).toMatchObject({ results: [{ status: "accepted" }] });
    const copy = await client.getPrompt(duplicate.promptId);
    expect(copy).toMatchObject({
      title: fixture.title,
      sourceTitle: fixture.sourceTitle,
      description: fixture.description,
      content: fixture.content,
    });
    await account.mutate([
      promptEdit(copy, { ...create.desired, title: "Edited copy" }),
    ]);
    expect(await client.getPrompt(copy.id)).toMatchObject({
      sourceTitle: fixture.sourceTitle,
    });
    expect(await client.getPrompt(create.promptId)).toMatchObject(
      create.desired
    );
  }
);

test("unchanged state updates and replay preserve modification dates; independent text and archive combine in either order", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  await account.mutate([create]);
  const base = await client.getPrompt(create.promptId);
  await account.mutate([promptState(base, "favorite", false)]);
  expect(await client.getPrompt(base.id)).toMatchObject({
    revision: base.revision,
    modifiedAt: base.modifiedAt,
  });
  await account.mutate([
    promptEdit(base, { ...create.desired, content: "Text first" }),
    promptState(base, "archived", true),
  ]);
  const archived = await client.getPrompt(base.id);
  expect(archived).toMatchObject({ archived: true, content: "Text first" });
  await account.mutate([promptState(base, "archived", true)]);
  expect(await client.getPrompt(base.id)).toMatchObject({
    revision: archived.revision,
    modifiedAt: archived.modifiedAt,
  });
  await account.mutate([
    promptState(archived, "archived", false),
    promptState(archived, "archived", true),
  ]);
  expect(await client.getPrompt(base.id)).toMatchObject({ archived: false });
});

test("all eligible archive pages are reachable and cursors cannot cross views or mutations", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const creates = Array.from({ length: 5 }, () => promptOperation());
  await account.mutate(creates);
  const originals = [];
  for (const entry of creates) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Respect the four-request account admission limit.
    originals.push(await client.getPrompt(entry.promptId));
  }
  await account.mutate(
    originals.map((prompt) => promptState(prompt, "archived", true))
  );
  const first = await client.getPrompts({ view: "archive", limit: 2 });
  expect(first.prompts).toHaveLength(2);
  if (!first.nextCursor) {
    throw new Error("Expected second page");
  }
  await expect(
    client.getPrompts({ view: "all", limit: 2, cursor: first.nextCursor })
  ).rejects.toMatchObject({ status: 400 });
  const second = await client.getPrompts({
    view: "archive",
    limit: 2,
    cursor: first.nextCursor,
  });
  if (!second.nextCursor) {
    throw new Error("Expected final page");
  }
  const third = await client.getPrompts({
    view: "archive",
    limit: 2,
    cursor: second.nextCursor,
  });
  expect(third.nextCursor).toBeNull();
  expect(
    new Set(
      [...first.prompts, ...second.prompts, ...third.prompts].map(
        (entry) => entry.id
      )
    ).size
  ).toBe(5);
  const [original] = originals;
  if (!original) {
    throw new Error("Expected prompt");
  }
  await account.mutate([
    promptState(await client.getPrompt(original.id), "archived", false),
  ]);
  await expect(
    client.getPrompts({ view: "archive", limit: 2, cursor: first.nextCursor })
  ).rejects.toMatchObject({ status: 409, detail: { code: "results_changed" } });
  const active = await client.getPrompts();
  expect(active.prompts.map((entry) => entry.id)).toEqual([original.id]);
});

test.each(["promptCount", "textBytes"] as const)(
  "quota refusal of duplication is atomic and retryable at %s capacity",
  async (resource) => {
    const account = await promptBrowser();
    const client = promptClient(account.Cookie);
    await seedCapacity(account.identity, resource);
    const page = await client.getPrompts();
    const sourceId = page.prompts[0]?.id;
    if (!sourceId) {
      throw new Error("Expected seeded source");
    }
    const source = await client.getPrompt(sourceId);
    if (resource === "promptCount") {
      await account.mutate([promptOperation()]);
    }
    const before = await client.getPrompts();
    const duplicate: DuplicatePrompt = {
      ...promptOperation({
        title: source.title,
        description: source.description,
        content: source.content,
      }),
      kind: "prompt.duplicate",
      sourceId,
    };
    const envelope = { ...account.identity, operations: [duplicate] };
    expect(await client.mutatePrompts(envelope)).toMatchObject({
      results: [
        {
          status: "rejected",
          error: { code: "quota_exceeded", resource, retryable: true },
        },
      ],
    });
    expect(await client.getPrompts()).toEqual(before);
    await expect(client.getPrompt(duplicate.promptId)).rejects.toMatchObject({
      status: 404,
    });
    expect(await client.mutatePrompts(envelope)).toMatchObject({
      results: [{ status: "rejected", error: { code: "quota_exceeded" } }],
    });
    expect(
      await client.mutatePrompts({
        ...account.identity,
        operations: [
          {
            ...duplicate,
            desired: { ...duplicate.desired, title: "Changed retry" },
          },
        ],
      })
    ).toMatchObject({
      results: [
        { status: "rejected", error: { code: "operation_identity_reused" } },
      ],
    });
    await account.mutate([
      { ...promptState(source, "archived", true), baseRevision: "0" },
    ]);
    const archive = await client.getPrompts({ view: "archive" });
    expect(archive.prompts).toHaveLength(1);
    expect(archive.usage).toEqual(before.usage);
  }
);

test("foreign source and target identities are refused without leaking library data", async () => {
  const owner = await promptBrowser();
  const other = await promptBrowser();
  const create = promptOperation();
  await owner.mutate([create]);
  const source = await promptClient(owner.Cookie).getPrompt(create.promptId);
  const client = promptClient(other.Cookie);
  const duplicate: DuplicatePrompt = {
    ...promptOperation(),
    kind: "prompt.duplicate",
    sourceId: create.promptId,
  };
  expect(
    await client.mutatePrompts({
      ...other.identity,
      operations: [
        duplicate,
        { ...promptState(source, "archived", true), baseRevision: "0" },
      ],
    })
  ).toMatchObject({
    results: [
      { status: "rejected", error: { code: "not_found" } },
      { status: "rejected", error: { code: "not_found" } },
    ],
  });
  expect(await client.getPrompts()).toMatchObject({
    usage: { promptCount: 0 },
  });
  expect(await promptClient(owner.Cookie).getPrompt(create.promptId)).toEqual(
    source
  );
});

test("archive retains usage, duplication resets it, and restore makes the original eligible for Recents", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  await account.mutate([create]);
  await seedPromptUsage(account.identity, create.promptId);
  const source = await client.getPrompt(create.promptId);
  await account.mutate([promptState(source, "archived", true)]);
  expect(await client.getPrompts({ view: "recents" })).toMatchObject({
    prompts: [],
  });
  const archived = await client.getPrompt(source.id);
  expect(archived).toMatchObject({
    useCount: 7,
    lastUsedAt: "2026-09-19T12:00:00.000Z",
  });
  const duplicate: DuplicatePrompt = {
    ...promptOperation(create.desired),
    kind: "prompt.duplicate",
    sourceId: source.id,
  };
  await account.mutate([duplicate, promptState(archived, "archived", false)]);
  expect(await client.getPrompt(duplicate.promptId)).toMatchObject({
    useCount: 0,
    lastUsedAt: null,
  });
  expect(await client.getPrompts({ view: "recents" })).toMatchObject({
    prompts: [{ id: source.id }],
  });
});
