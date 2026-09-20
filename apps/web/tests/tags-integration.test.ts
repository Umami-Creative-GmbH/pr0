import { expect, test } from "bun:test";

import { organizationIdentityFixtures } from "@pr0/api-contract/organization-fixtures";
import type { MutationEnvelope } from "@pr0/api-contract/prompts";

import { post, origin } from "./http-fixture";
import { seedCapacity } from "./prompt-capacity-fixture";
import {
  promptEdit,
  promptDeletion,
  promptBrowser,
  promptClient,
  promptOperation,
} from "./prompt-fixture";
import { tagOperation, tagDelta, seedTags } from "./tag-fixture";

test("equivalent tag creation races resolve to one unused identity and replay their mapping", async () => {
  const account = await promptBrowser();
  const operations = ["Straße", "STRASSE"].map((name) => ({
    kind: "tag.create",
    operationId: crypto.randomUUID(),
    tagId: crypto.randomUUID(),
    baseRevision: "0",
    dependsOn: [],
    name,
  }));
  const submit = (operation: (typeof operations)[number]) =>
    post(
      "/api/v1/sync/mutations",
      { ...account.identity, operations: [operation] },
      { Cookie: account.Cookie }
    );
  const responses = await Promise.all(operations.map(submit));
  for (const response of responses) {
    expect(response.status).toBe(200);
  }
  const receipts = await Promise.all(
    responses.map((response) => response.json())
  );
  const snapshotResponse = await fetch(
    `${origin}/api/v1/library/organization`,
    {
      headers: { Cookie: account.Cookie },
    }
  );
  const snapshot = await snapshotResponse.json();
  expect(snapshot.tags).toHaveLength(1);
  expect(snapshot.tags[0]).toMatchObject({
    activeCount: 0,
    archivedCount: 0,
    totalCount: 0,
  });
  expect(receipts.map((receipt) => receipt.results[0].resolvedTagId)).toEqual([
    snapshot.tags[0].id,
    snapshot.tags[0].id,
  ]);
  expect(
    new Set(receipts.map((receipt) => receipt.results[0].outcome))
  ).toEqual(new Set(["created", "existing"]));
  const replay = await Promise.all(operations.map(submit));
  expect(await Promise.all(replay.map((response) => response.json()))).toEqual(
    receipts
  );
});

test("prompt creation, duplication, and required conflict preservation retain tags", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const tag = tagOperation("Retained");
  await account.mutate([tag]);
  const create = promptOperation();
  const response = await post(
    "/api/v1/sync/mutations",
    {
      ...account.identity,
      operations: [
        { ...create, desired: { ...create.desired, tagIds: [tag.tagId] } },
      ],
    },
    { Cookie: account.Cookie }
  );
  expect(response.status).toBe(200);
  const original = await client.getPrompt(create.promptId);
  expect(original.tagIds).toEqual([tag.tagId]);
  const duplicateId = crypto.randomUUID();
  await account.mutate([
    {
      ...promptOperation(),
      kind: "prompt.duplicate",
      promptId: duplicateId,
      sourceId: original.id,
      desired: {
        title: original.title,
        description: original.description,
        content: original.content,
        tagIds: original.tagIds,
      },
    },
  ]);
  const duplicate = await client.getPrompt(duplicateId);
  expect(duplicate.tagIds).toEqual([tag.tagId]);
  await account.mutate([
    promptEdit(original, {
      title: original.title,
      description: original.description,
      content: "First edit",
    }),
  ]);
  const result = await client.mutatePrompts({
    ...account.identity,
    operations: [
      promptEdit(original, {
        title: original.title,
        description: original.description,
        content: "Competing edit",
      }),
    ],
  });
  const [receipt] = result.results;
  if (
    receipt?.status !== "accepted" ||
    !("promptId" in receipt) ||
    !receipt.conflict
  ) {
    throw new Error("Expected conflict copy");
  }
  const editCopy = await client.getPrompt(receipt.conflict.copyId);
  expect(editCopy.tagIds).toEqual([tag.tagId]);
  const deleted = await client.mutatePrompts({
    ...account.identity,
    operations: [promptDeletion(original)],
  });
  const [deletion] = deleted.results;
  if (
    deletion?.status !== "accepted" ||
    !("promptId" in deletion) ||
    !deletion.conflict
  ) {
    throw new Error("Expected deletion conflict copy");
  }
  const deletionCopy = await client.getPrompt(deletion.conflict.copyId);
  expect(deletionCopy.tagIds).toEqual([tag.tagId]);
});

test("delayed duplicates use submitted tag snapshots and never reread source memberships", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const first = tagOperation("Selected snapshot");
  const later = tagOperation("Later assignment");
  const create = promptOperation();
  create.desired = { ...create.desired, tagIds: [first.tagId] };
  await account.mutate([first, later, create]);
  const selected = await client.getPrompt(create.promptId);
  await account.mutate([
    tagDelta(
      create.promptId,
      selected.libraryRevision ?? selected.revision,
      [later.tagId],
      [first.tagId]
    ),
  ]);
  const desired = {
    title: selected.title,
    description: selected.description,
    content: selected.content,
  };
  const snapshotCopy = {
    ...promptOperation(),
    kind: "prompt.duplicate" as const,
    sourceId: selected.id,
    desired: { ...desired, tagIds: selected.tagIds },
  };
  const legacyCopy = {
    ...promptOperation(),
    kind: "prompt.duplicate" as const,
    sourceId: selected.id,
    desired,
  };
  await account.mutate([snapshotCopy, legacyCopy]);
  const copied = await client.getPrompt(snapshotCopy.promptId);
  const legacy = await client.getPrompt(legacyCopy.promptId);
  expect(copied.tagIds).toEqual([first.tagId]);
  expect(legacy.tagIds).toEqual([]);
});

test.each([...organizationIdentityFixtures])(
  "tag identity preserves Unicode distinctions for $name",
  async (fixture) => {
    const account = await promptBrowser();
    const client = promptClient(account.Cookie);
    const first = tagOperation(fixture.name);
    const equivalent = tagOperation(fixture.equivalent);
    const distinct = tagOperation(fixture.distinct);
    expect(
      await client.mutatePrompts({
        ...account.identity,
        operations: [first, equivalent, distinct],
      })
    ).toMatchObject({
      results: [
        { status: "accepted", outcome: "created" },
        { status: "accepted", resolvedTagId: first.tagId, outcome: "existing" },
        { status: "accepted", outcome: "created" },
      ],
    });
    const identitySnapshot = await client.getOrganization();
    expect(identitySnapshot.tags).toHaveLength(2);
  }
);

test("tag count, names and shared text limits preserve entries and permit equivalent creation at capacity", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  await seedTags(account.identity, 999);
  const last = tagOperation("🧡".repeat(60));
  await account.mutate([last]);
  const atCapacity = await client.getOrganization();
  expect(atCapacity.tags).toHaveLength(1000);
  expect(
    await client.mutatePrompts({
      ...account.identity,
      operations: [
        tagOperation("Extra"),
        tagOperation("TAG 0001"),
        tagOperation("🧡".repeat(61)),
        tagOperation("\u0000"),
        tagOperation("\uD800"),
        tagOperation("  "),
      ],
    })
  ).toMatchObject({
    results: [
      {
        status: "rejected",
        error: { code: "quota_exceeded", resource: "tagCount" },
      },
      { status: "accepted", outcome: "existing" },
      ...Array.from({ length: 4 }, () => ({
        status: "rejected",
        error: { code: "validation_failed" },
      })),
    ],
  });
  const textAccount = await promptBrowser();
  const textClient = promptClient(textAccount.Cookie);
  await seedCapacity(textAccount.identity, "textBytes");
  const fits = tagOperation("ab");
  await textAccount.mutate([fits]);
  const full = await textClient.getOrganization();
  expect(full.textBytes).toBe(104_857_600);
  expect(
    await textClient.mutatePrompts({
      ...textAccount.identity,
      operations: [tagOperation("abc", fits.tagId)],
    })
  ).toMatchObject({
    results: [{ status: "rejected", error: { resource: "textBytes" } }],
  });
  expect(await textClient.getOrganization()).toEqual(full);
  await textAccount.mutate([tagOperation("a", fits.tagId)]);
  const shortenedSnapshot = await textClient.getOrganization();
  expect(shortenedSnapshot.textBytes).toBe(104_857_599);
});

test("20 assignments are enforced atomically with library ownership and colliding rename protection", async () => {
  const account = await promptBrowser();
  const foreign = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  const tags = Array.from({ length: 21 }, (_, i) => tagOperation(`Tag ${i}`));
  const other = tagOperation("Private tag");
  await foreign.mutate([other]);
  await account.mutate([create, ...tags]);
  const ids = tags.map((tag) => tag.tagId);
  await account.mutate([tagDelta(create.promptId, "0", ids.slice(0, 20))]);
  const baseline = await client.getPrompt(create.promptId);
  expect(baseline.tagIds).toHaveLength(20);
  expect(
    await client.mutatePrompts({
      ...account.identity,
      operations: [
        tagDelta(create.promptId, baseline.revision, ids.slice(20)),
        tagDelta(create.promptId, baseline.revision, [other.tagId]),
        tagOperation("tag 1", tags[0]?.tagId),
      ],
    })
  ).toMatchObject({
    results: [
      {
        status: "rejected",
        error: { code: "quota_exceeded", resource: "tagsPerPrompt" },
      },
      { status: "rejected", error: { code: "validation_failed" } },
      { status: "rejected", error: { code: "name_conflict" } },
    ],
  });
  expect(await client.getPrompt(create.promptId)).toMatchObject({
    tagIds: baseline.tagIds,
    modifiedAt: baseline.modifiedAt,
  });
  await account.mutate([
    tagDelta(
      create.promptId,
      baseline.revision,
      ids.slice(20),
      ids.slice(0, 1)
    ),
  ]);
  const replacedAssignment = await client.getPrompt(create.promptId);
  expect(replacedAssignment.tagIds).toHaveLength(20);
});

test("tag filters combine by identity with AND and bind paginated cursors", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const first = tagOperation("Café");
  const second = tagOperation("Cafe");
  const a = promptOperation({ title: "Both A", description: "", content: "A" });
  const b = promptOperation({ title: "Both B", description: "", content: "B" });
  const c = promptOperation({
    title: "Only first",
    description: "",
    content: "C",
  });
  await account.mutate([
    first,
    second,
    a,
    b,
    c,
    tagDelta(a.promptId, "0", [first.tagId, second.tagId]),
    tagDelta(b.promptId, "0", [first.tagId, second.tagId]),
    tagDelta(c.promptId, "0", [first.tagId]),
  ]);
  const get = (tags: string[], cursor?: string) =>
    account.get(
      `?limit=1&tagIds=${tags.join(",")}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
    );
  const response = await get([first.tagId, second.tagId]);
  expect(response.status).toBe(200);
  const page = await response.json();
  expect(page.prompts).toHaveLength(1);
  expect(page.prompts[0].id).toBe(b.promptId);
  const nextPageResponse = await get(
    [first.tagId, second.tagId],
    page.nextCursor
  );
  const nextPage = await nextPageResponse.json();
  expect(nextPage.prompts[0].id).toBe(a.promptId);
  const mismatchedCursor = await get([first.tagId], page.nextCursor);
  expect(mismatchedCursor.status).toBe(400);
  const missingTagResponse = await get([crypto.randomUUID()]);
  const missingTagPage = await missingTagResponse.json();
  expect(missingTagPage.prompts).toEqual([]);
  const before = await client.getPrompt(a.promptId);
  await account.mutate([tagOperation("Ready", first.tagId)]);
  expect(await client.getPrompt(a.promptId)).toMatchObject({
    modifiedAt: before.modifiedAt,
    tagIds: before.tagIds,
  });
});

test("tag deltas retain unused tags, combine independently, and respect observed removals", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const tagId = crypto.randomUUID();
  const create = promptOperation();
  const other = promptOperation();
  const submit = async (operation: MutationEnvelope["operations"][number]) => {
    const response = await post(
      "/api/v1/sync/mutations",
      { ...account.identity, operations: [operation] },
      { Cookie: account.Cookie }
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  await submit({
    kind: "tag.create",
    tagId,
    name: "Draft",
    operationId: crypto.randomUUID(),
    baseRevision: "0",
    dependsOn: [],
  });
  await account.mutate([create, other]);
  const baseline = await client.getOrganization();
  expect(
    await submit(tagDelta(create.promptId, baseline.revision, [tagId], []))
  ).toMatchObject({ results: [{ status: "accepted" }] });
  await submit(tagDelta(other.promptId, baseline.revision, [tagId], []));
  const assigned = await client.getPrompt(create.promptId);
  expect(assigned).toMatchObject({ tagIds: [tagId] });
  const removal = await submit(
    tagDelta(create.promptId, assigned.revision, [], [tagId])
  );
  expect(
    await submit(tagDelta(create.promptId, baseline.revision, [tagId], []))
  ).toMatchObject({
    results: [
      {
        status: "accepted",
        organizationNotice: expect.stringContaining("removal"),
      },
    ],
  });
  expect(await client.getPrompt(create.promptId)).toMatchObject({ tagIds: [] });
  expect(await client.getPrompt(other.promptId)).toMatchObject({
    tagIds: [tagId],
  });
  await submit(
    tagDelta(create.promptId, removal.results[0].revision, [tagId], [])
  );
  expect(await client.getPrompt(create.promptId)).toMatchObject({
    tagIds: [tagId],
  });
  const observed = await client.getOrganization();
  await submit(tagDelta(create.promptId, observed.revision, [], [tagId]));
  await submit(tagDelta(other.promptId, observed.revision, [], [tagId]));
  expect(await client.getOrganization()).toMatchObject({
    tags: [{ id: tagId, totalCount: 0 }],
  });
});
