import { expect, test } from "bun:test";

import { organizationIdentityFixtures } from "@pr0/api-contract/organization-fixtures";

import {
  collectionOperation,
  assignCollection,
  seedCollections,
} from "./collection-fixture";
import { origin, post } from "./http-fixture";
import { seedCapacity } from "./prompt-capacity-fixture";
import {
  promptEdit,
  promptDeletion,
  promptBrowser,
  promptClient,
  promptOperation,
  promptState,
} from "./prompt-fixture";

test("create collection is library-owned, acknowledged once and visible with zero snapshot counts", async () => {
  const account = await promptBrowser();
  const operation = {
    kind: "collection.create",
    operationId: crypto.randomUUID(),
    collectionId: crypto.randomUUID(),
    baseRevision: "0",
    dependsOn: [],
    name: "  Straße  ",
  };
  const envelope = { ...account.identity, operations: [operation] };
  const submit = () =>
    post("/api/v1/sync/mutations", envelope, { Cookie: account.Cookie });
  const response = await submit();
  expect(response.status).toBe(200);
  const receipt = await response.json();
  expect(receipt).toMatchObject({
    results: [{ status: "accepted", collectionId: operation.collectionId }],
  });
  const replay = await submit();
  expect(await replay.json()).toEqual(receipt);
  const snapshot = await fetch(`${origin}/api/v1/library/organization`, {
    headers: { Cookie: account.Cookie },
  });
  expect(snapshot.status).toBe(200);
  expect(await snapshot.json()).toMatchObject({
    accountId: account.identity.accountId,
    collections: [
      {
        id: operation.collectionId,
        name: "Straße",
        activeCount: 0,
        archivedCount: 0,
        totalCount: 0,
      },
    ],
  });
});

test("a collision keeps dependent prompt creation blocked while unrelated work commits; corrected operations get new identities", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  await account.mutate([collectionOperation("Work")]);
  const rejected = collectionOperation("WORK");
  const dependent = promptOperation();
  dependent.dependsOn = [rejected.operationId];
  dependent.desired = {
    ...dependent.desired,
    collectionId: rejected.collectionId,
  };
  const unrelated = promptOperation();
  expect(
    await client.mutatePrompts({
      ...account.identity,
      operations: [rejected, dependent, unrelated],
    })
  ).toMatchObject({
    results: [
      { status: "rejected", error: { code: "name_conflict" } },
      { status: "rejected", error: { code: "dependency_blocked" } },
      { status: "accepted" },
    ],
  });
  expect(
    await client.mutatePrompts({
      ...account.identity,
      operations: [{ ...rejected, name: "Corrected" }],
    })
  ).toMatchObject({
    results: [
      { status: "rejected", error: { code: "operation_identity_reused" } },
    ],
  });
  const correction = {
    ...rejected,
    operationId: crypto.randomUUID(),
    name: "Corrected",
  };
  const correctedPrompt = {
    ...dependent,
    operationId: crypto.randomUUID(),
    dependsOn: [correction.operationId],
  };
  expect(
    await client.mutatePrompts({
      ...account.identity,
      operations: [correction, correctedPrompt],
    })
  ).toMatchObject({
    results: [{ status: "accepted" }, { status: "accepted" }],
  });
  expect(await client.getPrompt(dependent.promptId)).toMatchObject({
    collectionId: correction.collectionId,
  });
});

test("all 200 collections remain reachable; count and shared text quotas reject atomically", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  await seedCollections(account.identity, 179);
  const belowWarning = await client.getOrganization();
  expect(belowWarning.collections).toHaveLength(179);
  await account.mutate([collectionOperation("Boundary 180")]);
  const atWarning = await client.getOrganization();
  expect(atWarning.collections).toHaveLength(180);
  await account.mutate(
    Array.from({ length: 20 }, (_, index) =>
      collectionOperation(`Extra ${index}`)
    )
  );
  const full = await client.getOrganization();
  expect(full.collections).toHaveLength(200);
  expect(full.collections[0]?.name).toBe("Boundary 180");
  const refused = collectionOperation("Over capacity");
  expect(
    await client.mutatePrompts({ ...account.identity, operations: [refused] })
  ).toMatchObject({
    results: [
      {
        status: "rejected",
        error: { code: "quota_exceeded", resource: "collectionCount" },
      },
    ],
  });
  expect(await client.getOrganization()).toEqual(full);
  const [first] = full.collections;
  if (!first) {
    throw new Error("Missing collection");
  }
  expect(
    await client.mutatePrompts({
      ...account.identity,
      operations: [collectionOperation("Renamed at capacity", first.id)],
    })
  ).toMatchObject({ results: [{ status: "accepted" }] });
  const textAccount = await promptBrowser();
  const textClient = promptClient(textAccount.Cookie);
  await seedCapacity(textAccount.identity, "textBytes");
  const fits = collectionOperation("ab");
  await textAccount.mutate([fits]);
  const textFull = await textClient.getOrganization();
  expect(textFull.textBytes).toBe(104_857_600);
  expect(
    await textClient.mutatePrompts({
      ...textAccount.identity,
      operations: [collectionOperation("c")],
    })
  ).toMatchObject({
    results: [
      {
        status: "rejected",
        error: { code: "quota_exceeded", resource: "textBytes" },
      },
    ],
  });
  expect(await textClient.getOrganization()).toEqual(textFull);
  await textAccount.mutate([
    collectionOperation("a", fits.collectionId),
    collectionOperation("c"),
  ]);
  const reduced = await textClient.getOrganization();
  expect(reduced.collections).toHaveLength(2);
});

test("foreign collection mutations and references are denied without changing either library", async () => {
  const owner = await promptBrowser();
  const other = await promptBrowser();
  const foreign = collectionOperation("Private");
  await owner.mutate([foreign]);
  const client = promptClient(other.Cookie);
  const prompt = promptOperation();
  await other.mutate([prompt]);
  const original = await client.getPrompt(prompt.promptId);
  const ownBefore = await promptClient(owner.Cookie).getOrganization();
  expect(
    await client.mutatePrompts({
      ...other.identity,
      operations: [
        collectionOperation("Stolen", foreign.collectionId),
        assignCollection(original, foreign.collectionId),
        {
          ...promptOperation(),
          desired: { ...prompt.desired, collectionId: foreign.collectionId },
        },
      ],
    })
  ).toMatchObject({
    results: [
      { status: "rejected", error: { code: "not_found" } },
      { status: "rejected", error: { code: "validation_failed" } },
      { status: "rejected", error: { code: "validation_failed" } },
    ],
  });
  expect(await client.getPrompt(original.id)).toEqual(original);
  expect(await promptClient(owner.Cookie).getOrganization()).toEqual(ownBefore);
  expect(
    await client.mutatePrompts({
      ...owner.identity,
      operations: [collectionOperation("Spoofed")],
    })
  ).toMatchObject({
    results: [{ status: "rejected", error: { code: "forbidden" } }],
  });
});

test("moving and unassigning are idempotent; concurrent assignments explain supersession and text copies keep organization", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const a = collectionOperation("A");
  const b = collectionOperation("B");
  const create = promptOperation();
  await account.mutate([a, b, create]);
  const base = await client.getPrompt(create.promptId);
  await account.mutate([assignCollection(base, a.collectionId)]);
  const move = assignCollection(base, b.collectionId);
  const receipt = await client.mutatePrompts({
    ...account.identity,
    operations: [move],
  });
  expect(receipt).toMatchObject({
    results: [
      {
        status: "accepted",
        organizationNotice:
          "A concurrent collection assignment was superseded by this saved choice.",
      },
    ],
  });
  expect(
    await client.mutatePrompts({ ...account.identity, operations: [move] })
  ).toEqual(receipt);
  const moved = await client.getPrompt(base.id);
  await account.mutate([assignCollection(moved, b.collectionId)]);
  expect(await client.getPrompt(base.id)).toEqual(moved);
  const edit = promptEdit(moved, {
    title: moved.title,
    description: "",
    content: "First variant",
  });
  await account.mutate([edit]);
  const competing = promptEdit(moved, {
    title: moved.title,
    description: "",
    content: "Second variant",
  });
  const result = await client.mutatePrompts({
    ...account.identity,
    operations: [competing],
  });
  const [accepted] = result.results;
  if (
    accepted?.status !== "accepted" ||
    !("promptId" in accepted) ||
    !accepted.conflict
  ) {
    throw new Error("Missing preserved copy");
  }
  expect(await client.getPrompt(accepted.conflict.copyId)).toMatchObject({
    collectionId: b.collectionId,
  });
  await account.mutate([promptDeletion(moved)]);
  const all = await client.getOrganization();
  expect(
    all.collections.find((entry) => entry.id === b.collectionId)?.totalCount
  ).toBe(2);
  const copy = await client.getPrompt(accepted.conflict.copyId);
  await account.mutate([assignCollection(copy, null)]);
  expect(await client.getPrompt(copy.id)).toMatchObject({ collectionId: null });
});

test.each([...organizationIdentityFixtures])(
  "Unicode 17 identity: $name",
  async ({ name, equivalent, distinct }) => {
    const account = await promptBrowser();
    const client = promptClient(account.Cookie);
    const first = collectionOperation(name);
    const response = await client.mutatePrompts({
      ...account.identity,
      operations: [
        first,
        collectionOperation(equivalent),
        collectionOperation(distinct),
        collectionOperation(equivalent, first.collectionId),
      ],
    });
    expect(
      response.results.map((entry) =>
        entry.status === "accepted" ? "accepted" : entry.error.code
      )
    ).toEqual(["accepted", "name_conflict", "accepted", "accepted"]);
    const snapshot = await client.getOrganization();
    expect(snapshot.collections).toHaveLength(2);
  }
);

test("invalid names retain the library; code point limits admit 60 supplementary characters", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const response = await client.mutatePrompts({
    ...account.identity,
    operations: [
      "",
      " \u0085 ",
      "a\u0000b",
      "\uD800",
      "😀".repeat(61),
      "😀".repeat(60),
    ].map((name) => collectionOperation(name)),
  });
  expect(
    response.results.map((entry) =>
      entry.status === "accepted" ? "accepted" : entry.error.code
    )
  ).toEqual([
    "validation_failed",
    "validation_failed",
    "validation_failed",
    "validation_failed",
    "validation_failed",
    "accepted",
  ]);
  const snapshot = await client.getOrganization();
  expect(snapshot.collections).toHaveLength(1);
});

test("assignment changes dates, rename preserves them, and counts include archive", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const work = collectionOperation("Work");
  const prompt = promptOperation();
  await account.mutate([work, prompt]);
  const original = await client.getPrompt(prompt.promptId);
  const response = await post(
    "/api/v1/sync/mutations",
    {
      ...account.identity,
      operations: [assignCollection(original, work.collectionId)],
    },
    { Cookie: account.Cookie }
  );
  expect(await response.json()).toMatchObject({
    results: [{ status: "accepted" }],
  });
  const assigned = await client.getPrompt(original.id);
  expect(assigned).toMatchObject({ collectionId: work.collectionId });
  expect(assigned.modifiedAt > original.modifiedAt).toBe(true);
  await account.mutate([collectionOperation("WORK", work.collectionId)]);
  expect(await client.getPrompt(original.id)).toMatchObject({
    modifiedAt: assigned.modifiedAt,
    collectionId: work.collectionId,
  });
  await account.mutate([promptState(assigned, "archived", true)]);
  expect(await client.getOrganization()).toMatchObject({
    collections: [
      { name: "WORK", activeCount: 0, archivedCount: 1, totalCount: 1 },
    ],
  });
});
