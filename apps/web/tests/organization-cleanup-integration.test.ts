import { expect, test } from "bun:test";

import { organizationMergeFixture } from "@pr0/api-contract/organization-fixtures";
import type { MutationEnvelope } from "@pr0/api-contract/prompts";

import { collectionOperation, assignCollection } from "./collection-fixture";
import { origin, post } from "./http-fixture";
import {
  withOrganizationStorageFailure,
  seedOrganizationCapacity,
} from "./organization-cleanup-fixture";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptState,
  promptDeletion,
} from "./prompt-fixture";
import { tagOperation, tagDelta } from "./tag-fixture";

test("explicit merge preserves overlapping active/archive prompts and its replayable observed effects", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const source = tagOperation("Draft");
  const target = tagOperation("Writing");
  await account.mutate([source, target]);
  const prompts = ["A", "B", "C", "D"].map((title, index) => {
    const create = promptOperation();
    let tagIds = [source.tagId];
    if (index === 1) {
      tagIds = [source.tagId, target.tagId];
    }
    if (index === 3) {
      tagIds = [target.tagId];
    }
    return {
      ...create,
      desired: {
        ...create.desired,
        title,
        tagIds,
      },
    };
  });
  await account.mutate(prompts);
  const archivedCreate = prompts.at(2);
  if (!archivedCreate) {
    throw new Error("Missing archived fixture");
  }
  const archived = await client.getPrompt(archivedCreate.promptId);
  await account.mutate([promptState(archived, "archived", true)]);
  const snapshot = await client.getOrganization();
  const operation = {
    kind: "tag.merge",
    operationId: crypto.randomUUID(),
    tagId: source.tagId,
    targetId: target.tagId,
    baseRevision: snapshot.revision,
    dependsOn: [],
  };
  const envelope = { ...account.identity, operations: [operation] };
  const response = await post("/api/v1/sync/mutations", envelope, {
    Cookie: account.Cookie,
  });
  expect(response.status).toBe(200);
  const receipt = await response.json();
  expect(receipt.results[0]).toMatchObject({
    status: "accepted",
    effect: {
      kind: "tag.merge",
      sourceId: source.tagId,
      sourceName: "Draft",
      targetId: target.tagId,
      targetName: "Writing",
      ...organizationMergeFixture.expected,
    },
  });
  const saved = await Promise.all(
    prompts.map((create) => client.getPrompt(create.promptId))
  );
  for (const prompt of saved) {
    expect(prompt.tagIds).toEqual([target.tagId]);
    expect(prompt.title).toBe(
      prompts.find((create) => create.promptId === prompt.id)?.desired.title ??
        "Missing fixture"
    );
  }
  const after = await client.getOrganization();
  expect(after.tags).toMatchObject([
    { id: target.tagId, name: "Writing", activeCount: 3, archivedCount: 1 },
  ]);
  const review = await fetch(
    `${origin}/api/v1/library/organization/operations/${operation.operationId}`,
    { headers: { Cookie: account.Cookie } }
  );
  expect(review.status).toBe(200);
  const body = await review.json();
  expect(
    new Set(body.prompts.map((entry: { id: string }) => entry.id))
  ).toEqual(new Set(prompts.slice(0, 3).map((entry) => entry.promptId)));
  const replay = await post("/api/v1/sync/mutations", envelope, {
    Cookie: account.Cookie,
  });
  expect(await replay.json()).toEqual(receipt);
});

test("deletion preserves prompts, wins over stale collection assignments and keeps original review membership", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const collection = collectionOperation("Work");
  const create = promptOperation();
  await account.mutate([
    collection,
    {
      ...create,
      desired: { ...create.desired, collectionId: collection.collectionId },
    },
  ]);
  const before = await client.getPrompt(create.promptId);
  const snapshot = await client.getOrganization();
  const operation = {
    kind: "collection.delete" as const,
    operationId: crypto.randomUUID(),
    collectionId: collection.collectionId,
    baseRevision: snapshot.revision,
    dependsOn: [],
  };
  const result = await client.mutatePrompts({
    ...account.identity,
    operations: [operation],
  });
  expect(result.results[0]).toMatchObject({
    status: "accepted",
    effect: { activeCount: 1, archivedCount: 0 },
  });
  const stale = assignCollection(
    { ...before, collectionId: null },
    collection.collectionId
  );
  const staleResult = await client.mutatePrompts({
    ...account.identity,
    operations: [stale],
  });
  expect(staleResult.results[0]).toMatchObject({
    status: "accepted",
    organizationNotice: expect.any(String),
  });
  expect(await client.getPrompt(before.id)).toMatchObject({
    content: before.content,
    collectionId: null,
  });
  const replacement = collectionOperation("Work");
  await account.mutate([replacement]);
  await account.mutate([
    assignCollection(
      await client.getPrompt(before.id),
      replacement.collectionId
    ),
  ]);
  const review = await client.getOrganizationReview(operation.operationId);
  expect(review.prompts).toMatchObject([
    { id: before.id, current: { collectionId: replacement.collectionId } },
  ]);
  const filtered = await client.getPrompts({
    collectionId: collection.collectionId,
  });
  expect(filtered.prompts).toEqual([]);
  const states = await client.getOrganizationStates([collection.collectionId]);
  expect(states.states).toMatchObject([
    { id: collection.collectionId, state: "deleted" },
  ]);
});

test("stale tag assignments follow same-library merge aliases, stop at deleted targets and never rename the target", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const source = tagOperation("Draft");
  const target = tagOperation("Writing");
  const create = promptOperation();
  await account.mutate([source, target, create]);
  const snapshot = await client.getOrganization();
  const merge = {
    kind: "tag.merge" as const,
    operationId: crypto.randomUUID(),
    tagId: source.tagId,
    targetId: target.tagId,
    baseRevision: snapshot.revision,
    dependsOn: [],
  };
  await client.mutatePrompts({ ...account.identity, operations: [merge] });
  const assignment = await client.mutatePrompts({
    ...account.identity,
    operations: [tagDelta(create.promptId, "0", [source.tagId])],
  });
  expect(assignment.results[0]).toMatchObject({
    status: "accepted",
    organizationNotice: expect.any(String),
  });
  const assigned = await client.getPrompt(create.promptId);
  expect(assigned.tagIds).toEqual([target.tagId]);
  const rename = await client.mutatePrompts({
    ...account.identity,
    operations: [tagOperation("Unexpected", source.tagId)],
  });
  expect(rename.results[0]).toMatchObject({
    status: "rejected",
    error: { code: "not_found" },
  });
  const beforeDelete = await client.getOrganization();
  await client.mutatePrompts({
    ...account.identity,
    operations: [
      {
        kind: "tag.delete",
        operationId: crypto.randomUUID(),
        tagId: target.tagId,
        baseRevision: beforeDelete.revision,
        dependsOn: [],
      },
    ],
  });
  const staleAssignment = await client.mutatePrompts({
    ...account.identity,
    operations: [tagDelta(create.promptId, "0", [source.tagId])],
  });
  expect(staleAssignment.results[0]).toMatchObject({ status: "accepted" });
  const final = await client.getPrompt(create.promptId);
  expect(final.tagIds).toEqual([]);
  const states = await client.getOrganizationStates([source.tagId]);
  expect(states.states).toMatchObject([{ state: "merged", targetId: null }]);
});

test("merge aliases cannot bypass an earlier explicit membership removal", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const source = tagOperation("Draft");
  const target = tagOperation("Writing");
  const create = promptOperation();
  await account.mutate([
    source,
    target,
    create,
    tagDelta(create.promptId, "0", [], [source.tagId]),
  ]);
  const snapshot = await client.getOrganization();
  await client.mutatePrompts({
    ...account.identity,
    operations: [
      {
        kind: "tag.merge",
        operationId: crypto.randomUUID(),
        tagId: source.tagId,
        targetId: target.tagId,
        baseRevision: snapshot.revision,
        dependsOn: [],
      },
    ],
  });
  await client.mutatePrompts({
    ...account.identity,
    operations: [tagDelta(create.promptId, "0", [source.tagId])],
  });
  const prompt = await client.getPrompt(create.promptId);
  expect(prompt.tagIds).toEqual([]);
});

test("failed bulk commit rolls back names, prompts, quota, revision and review; retry is exact", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const tag = tagOperation("Keep until committed");
  const create = promptOperation();
  await account.mutate([
    tag,
    { ...create, desired: { ...create.desired, tagIds: [tag.tagId] } },
  ]);
  const before = await client.getOrganization();
  const prompt = await client.getPrompt(create.promptId);
  const operation = {
    kind: "tag.delete" as const,
    operationId: crypto.randomUUID(),
    tagId: tag.tagId,
    baseRevision: before.revision,
    dependsOn: [],
  };
  const envelope = { ...account.identity, operations: [operation] };
  await withOrganizationStorageFailure(async () => {
    expect(await client.mutatePrompts(envelope)).toMatchObject({
      results: [
        { status: "rejected", error: { code: "temporarily_unavailable" } },
      ],
    });
    expect(await client.getOrganization()).toEqual(before);
    expect(await client.getPrompt(prompt.id)).toEqual(prompt);
    await expect(
      client.getOrganizationReview(operation.operationId)
    ).rejects.toMatchObject({ status: 404 });
  });
  const accepted = await client.mutatePrompts(envelope);
  expect(accepted).toMatchObject({ results: [{ status: "accepted" }] });
  expect(await client.mutatePrompts(envelope)).toEqual(accepted);
  const after = await client.getOrganization();
  expect(after.textBytes).toBe(
    before.textBytes - new TextEncoder().encode(tag.name).length
  );
});

test("cleanup rejects mixed batches, foreign targets and unobserved renames without changing assignments", async () => {
  const account = await promptBrowser();
  const other = await promptBrowser();
  const client = promptClient(account.Cookie);
  const source = tagOperation("Draft");
  const target = tagOperation("Writing");
  const foreign = tagOperation("Foreign");
  await account.mutate([source, target]);
  await other.mutate([foreign]);
  const before = await client.getOrganization();
  const operation = {
    kind: "tag.merge" as const,
    operationId: crypto.randomUUID(),
    tagId: source.tagId,
    targetId: foreign.tagId,
    baseRevision: before.revision,
    dependsOn: [],
  };
  expect(
    await client.mutatePrompts({ ...account.identity, operations: [operation] })
  ).toMatchObject({
    results: [{ status: "rejected", error: { code: "not_found" } }],
  });
  const mixed = await post(
    "/api/v1/sync/mutations",
    {
      ...account.identity,
      operations: [operation, tagOperation("Should not exist")],
    },
    { Cookie: account.Cookie }
  );
  expect(mixed.status).toBe(400);
  await account.mutate([tagOperation("Renamed target", target.tagId)]);
  const raced = {
    ...operation,
    operationId: crypto.randomUUID(),
    targetId: target.tagId,
  };
  expect(
    await client.mutatePrompts({ ...account.identity, operations: [raced] })
  ).toMatchObject({
    results: [{ status: "rejected", error: { code: "results_changed" } }],
  });
  const after = await client.getOrganization();
  expect(after.tags).toHaveLength(2);
});

test.each(["tag.delete", "tag.merge"] as const)(
  "10,000-prompt %s is bounded, atomic on failure and exposes every affected identity",
  async (kind) => {
    const account = await promptBrowser();
    const client = promptClient(account.Cookie);
    const tag = tagOperation("Capacity");
    const target = tagOperation("Capacity target");
    await account.mutate([tag, target]);
    await seedOrganizationCapacity(account.identity, tag.tagId);
    const snapshot = await client.getOrganization();
    const common = {
      operationId: crypto.randomUUID(),
      tagId: tag.tagId,
      baseRevision: snapshot.revision,
      dependsOn: [],
    };
    const envelope: MutationEnvelope = {
      ...account.identity,
      operations: [
        kind === "tag.merge"
          ? { ...common, kind, targetId: target.tagId }
          : { ...common, kind },
      ],
    };
    await withOrganizationStorageFailure(async () => {
      expect(await client.mutatePrompts(envelope)).toMatchObject({
        results: [{ status: "rejected" }],
      });
      expect(await client.getOrganization()).toEqual(snapshot);
    });
    const start = performance.now();
    const result = await client.mutatePrompts(envelope);
    const elapsed = performance.now() - start;
    const [receipt] = result.results;
    if (!receipt || receipt.status !== "accepted" || !("effect" in receipt)) {
      throw new Error("Cleanup was not accepted");
    }
    expect(receipt.effect).toMatchObject({
      activeCount: 5000,
      archivedCount: 5000,
    });
    expect(elapsed).toBeLessThan(2000);
    const identities = new Set<string>();
    let offset: number | null = 0;
    while (offset !== null) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each stable offset is supplied by the preceding bounded page.
      const page = await client.getOrganizationReview(
        receipt.operationId,
        offset
      );
      for (const entry of page.prompts) {
        identities.add(entry.id);
        expect(entry.current?.tagIds).toEqual(
          kind === "tag.merge" ? [target.tagId] : []
        );
      }
      offset = page.nextOffset;
    }
    expect(identities.size).toBe(10_000);
    process.stdout.write(
      `Organization ${kind}: 10000 prompts in ${elapsed.toFixed(0)} ms; all 100 review pages verified.\n`
    );
  }
);

test("alias chains expose only live targets, and affected review reflects archive moves and deletion without changing membership", async () => {
  const account = await promptBrowser();
  const other = await promptBrowser();
  const client = promptClient(account.Cookie);
  const source = tagOperation("First");
  const middle = tagOperation("Second");
  const target = tagOperation("Last");
  const create = promptOperation();
  await account.mutate([
    source,
    middle,
    target,
    { ...create, desired: { ...create.desired, tagIds: [source.tagId] } },
  ]);
  const snapshot = await client.getOrganization();
  const first = {
    kind: "tag.merge" as const,
    operationId: crypto.randomUUID(),
    tagId: source.tagId,
    targetId: middle.tagId,
    baseRevision: snapshot.revision,
    dependsOn: [],
  };
  await client.mutatePrompts({ ...account.identity, operations: [first] });
  const next = await client.getOrganization();
  await client.mutatePrompts({
    ...account.identity,
    operations: [
      {
        ...first,
        operationId: crypto.randomUUID(),
        tagId: middle.tagId,
        targetId: target.tagId,
        baseRevision: next.revision,
      },
    ],
  });
  const states = await client.getOrganizationStates([source.tagId]);
  expect(states.states).toMatchObject([
    { id: source.tagId, targetId: target.tagId, targetName: "Last" },
  ]);
  const otherClient = promptClient(other.Cookie);
  await expect(
    otherClient.getOrganizationReview(first.operationId)
  ).rejects.toMatchObject({ status: 404 });
  expect(await otherClient.getOrganizationStates([source.tagId])).toMatchObject(
    { states: [] }
  );
  const prompt = await client.getPrompt(create.promptId);
  await account.mutate([promptState(prompt, "archived", true)]);
  const archived = await client.getOrganizationReview(first.operationId);
  expect(archived.prompts).toMatchObject([
    { id: prompt.id, originallyArchived: false, current: { archived: true } },
  ]);
  const current = await client.getPrompt(prompt.id);
  await account.mutate([promptDeletion(current)]);
  const deleted = await client.getOrganizationReview(first.operationId);
  expect(deleted.prompts).toEqual([
    { id: prompt.id, originallyArchived: false, current: null },
  ]);
});
