import { expect, test } from "bun:test";

import { collectionOperation } from "./collection-fixture";
import { post, origin } from "./http-fixture";
import {
  promptBrowser,
  promptClient,
  promptEdit,
  promptOperation,
  promptDeletion,
} from "./prompt-fixture";

test("review acknowledgement is replayable and preserves both complete variants", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation({
    title: "🌍".repeat(200),
    description: "",
    content: "baseline",
  });
  await client.mutatePrompts({ ...account.identity, operations: [create] });
  const base = await client.getPrompt(create.promptId);
  await client.mutatePrompts({
    ...account.identity,
    operations: [promptEdit(base, { ...create.desired, content: "first" })],
  });
  await client.mutatePrompts({
    ...account.identity,
    operations: [promptEdit(base, { ...create.desired, content: "second" })],
  });
  const page = await client.getConflicts();
  const [notice] = page.notices;
  if (!notice) {
    throw new Error("Expected preserved conflict");
  }
  expect(notice).toBeDefined();
  const before = await client.getPrompt(notice.copyId);
  const envelope = {
    ...account.identity,
    operations: [
      {
        kind: "conflict.review",
        operationId: crypto.randomUUID(),
        promptId: notice.copyId,
        noticeId: notice.id,
        baseRevision: notice.revision,
        dependsOn: [],
      },
    ],
  };
  const response = await post("/api/v1/sync/mutations", envelope, {
    Cookie: account.Cookie,
  });
  expect(response.status).toBe(200);
  const receipt = await response.json();
  expect(receipt.results[0].status).toBe("accepted");
  const reviewed = await client.getConflicts();
  expect(reviewed.notices).toEqual([]);
  expect(await client.getPrompt(notice.copyId)).toMatchObject({
    content: "second",
    sourceTitle: create.desired.title,
    modifiedAt: before.modifiedAt,
  });
  expect(await client.getPrompt(base.id)).toMatchObject({ content: "first" });
  const replay = await post("/api/v1/sync/mutations", envelope, {
    Cookie: account.Cookie,
  });
  expect(await replay.json()).toEqual(receipt);
});

test("review stays account scoped and can acknowledge a copy deleted by another device", async () => {
  const owner = await promptBrowser();
  const client = promptClient(owner.Cookie);
  const create = promptOperation();
  await client.mutatePrompts({ ...owner.identity, operations: [create] });
  const base = await client.getPrompt(create.promptId);
  await client.mutatePrompts({
    ...owner.identity,
    operations: [promptEdit(base, { ...create.desired, content: "first" })],
  });
  await client.mutatePrompts({
    ...owner.identity,
    operations: [promptEdit(base, { ...create.desired, content: "second" })],
  });
  const conflicts = await client.getConflicts();
  const [notice] = conflicts.notices;
  if (!notice) {
    throw new Error("Expected conflict");
  }
  const operation = {
    kind: "conflict.review" as const,
    operationId: crypto.randomUUID(),
    promptId: notice.copyId,
    noticeId: notice.id,
    baseRevision: notice.revision,
    dependsOn: [],
  };
  const stranger = await promptBrowser();
  expect(
    await promptClient(stranger.Cookie).mutatePrompts({
      ...stranger.identity,
      operations: [{ ...operation, baseRevision: "0" }],
    })
  ).toMatchObject({
    results: [{ status: "rejected", error: { code: "not_found" } }],
  });
  const stillUnreviewed = await client.getConflicts();
  expect(stillUnreviewed.notices).toHaveLength(1);
  await client.mutatePrompts({
    ...owner.identity,
    operations: [promptDeletion(await client.getPrompt(notice.copyId))],
  });
  expect(
    await client.mutatePrompts({ ...owner.identity, operations: [operation] })
  ).toMatchObject({ results: [{ status: "accepted" }] });
  expect(
    await client.mutatePrompts({
      ...owner.identity,
      operations: [{ ...operation, noticeId: crypto.randomUUID() }],
    })
  ).toMatchObject({
    results: [
      { status: "rejected", error: { code: "operation_identity_reused" } },
    ],
  });
  const after = await client.getConflicts();
  expect(after.notices).toEqual([]);
  const original = await client.getPrompt(base.id);
  expect(original.content).toBe("first");
});

test("organization adjustment notices persist until reviewed without creating text conflicts", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const collection = collectionOperation("Removed collection");
  await client.mutatePrompts({ ...account.identity, operations: [collection] });
  await client.mutatePrompts({
    ...account.identity,
    operations: [
      {
        kind: "collection.delete",
        collectionId: collection.collectionId,
        operationId: crypto.randomUUID(),
        baseRevision: "1",
        dependsOn: [],
      },
    ],
  });
  const create = promptOperation();
  await client.mutatePrompts({
    ...account.identity,
    operations: [
      {
        ...create,
        desired: { ...create.desired, collectionId: collection.collectionId },
      },
    ],
  });
  const response = await fetch(`${origin}/api/v1/library/adjustments`, {
    headers: { Cookie: account.Cookie },
  });
  expect(response.status).toBe(200);
  const page = await response.json();
  expect(page.notices).toHaveLength(1);
  expect(page.notices[0].promptId).toBe(create.promptId);
  const review = {
    ...account.identity,
    operations: [
      {
        kind: "organization.review",
        operationId: crypto.randomUUID(),
        promptId: create.promptId,
        noticeId: create.operationId,
        baseRevision: "3",
        dependsOn: [],
      },
    ],
  };
  const reviewed = await post("/api/v1/sync/mutations", review, {
    Cookie: account.Cookie,
  });
  expect(await reviewed.json()).toMatchObject({
    results: [{ status: "accepted" }],
  });
  const after = await fetch(`${origin}/api/v1/library/adjustments`, {
    headers: { Cookie: account.Cookie },
  });
  expect(await after.json()).toMatchObject({ notices: [] });
  const conflicts = await client.getConflicts();
  expect(conflicts.notices).toEqual([]);
  expect(await client.getPrompt(create.promptId)).toMatchObject({
    content: create.desired.content,
    collectionId: null,
  });
});
