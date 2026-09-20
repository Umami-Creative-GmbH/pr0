// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Public REST journeys consume ordered pages and mutations.
import { expect, test } from "bun:test";

import { promptUseFixtures } from "@pr0/api-contract/prompt-use-fixtures";
import type { UsePrompt } from "@pr0/api-contract/prompts";

import { post } from "./http-fixture";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptState,
  promptDeletion,
} from "./prompt-fixture";

const use = (promptId: string, occurredAt: string): UsePrompt => ({
  kind: "prompt.use",
  operationId: crypto.randomUUID(),
  promptId,
  baseRevision: "0",
  dependsOn: [],
  occurredAt,
});

test("future use is corrected once, replay is idempotent and delayed use preserves dates and maximum", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  await account.mutate([create]);
  const before = await client.getPrompt(create.promptId);
  const operation = use(create.promptId, promptUseFixtures.future);
  const envelope = { ...account.identity, operations: [operation] };
  const receipt = await client.mutatePrompts(envelope);
  const used = await client.getPrompt(create.promptId);
  expect(used.useCount).toBe(1);
  const [result] = receipt.results;
  if (result?.status !== "accepted" || !("promptId" in result)) {
    throw new Error("Usage was not accepted");
  }
  expect(used.lastUsedAt).toBe(result.usedAt ?? null);
  expect(used.lastUsedAt).toBe(result.acceptedAt);
  expect(used.modifiedAt).toBe(before.modifiedAt);
  expect(await client.mutatePrompts(envelope)).toEqual(receipt);
  await client.mutatePrompts({
    ...account.identity,
    operations: [use(create.promptId, promptUseFixtures.old)],
  });
  const delayed = await client.getPrompt(create.promptId);
  expect(delayed.useCount).toBe(2);
  expect(delayed.lastUsedAt).toBe(used.lastUsedAt);
  expect(delayed.modifiedAt).toBe(before.modifiedAt);
  const changed = await client.mutatePrompts({
    ...envelope,
    operations: [{ ...operation, occurredAt: promptUseFixtures.newer }],
  });
  expect(changed.results[0]).toMatchObject({
    status: "rejected",
    error: { code: "operation_identity_reused" },
  });
});

test("Recents pages distinct active prompts by use time, title and identity; archive, restore, duplicate and deletion preserve rules", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const creates = ["Zulu", "Bravo", "Alpha", "Alpha", "Unused"].map((title) =>
    promptOperation({ title, description: "", content: "searchable body" })
  );
  await account.mutate(creates);
  const [zulu, bravo, alpha, alpha2, unused] = creates;
  if (!zulu || !bravo || !alpha || !alpha2 || !unused) {
    throw new Error("Missing fixture");
  }
  await account.mutate([
    use(zulu.promptId, promptUseFixtures.old),
    ...[bravo, alpha, alpha2].map((prompt) =>
      use(prompt.promptId, promptUseFixtures.newer)
    ),
  ]);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.getPrompts({ view: "recents", limit: 2, cursor });
    ids.push(...page.prompts.map((row) => row.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids).toEqual([
    ...(alpha.promptId < alpha2.promptId
      ? [alpha.promptId, alpha2.promptId]
      : [alpha2.promptId, alpha.promptId]),
    bravo.promptId,
    zulu.promptId,
  ]);
  const filtered = await client.getPrompts({
    view: "recents",
    query: "searchable",
    limit: 100,
  });
  expect(filtered.prompts).toHaveLength(4);
  const source = await client.getPrompt(alpha.promptId);
  await account.mutate([
    promptState(source, "archived", true),
    use(source.id, promptUseFixtures.future),
  ]);
  const active = await client.getPrompts({ view: "recents" });
  expect(active.prompts.map((row) => row.id)).not.toContain(source.id);
  const archived = await client.getPrompt(source.id);
  expect(archived.useCount).toBe(2);
  await account.mutate([promptState(archived, "archived", false)]);
  const restored = await client.getPrompts({ view: "recents" });
  expect(restored.prompts[0]?.id).toBe(source.id);
  const duplicateId = crypto.randomUUID();
  await account.mutate([
    {
      ...promptOperation(),
      promptId: duplicateId,
      kind: "prompt.duplicate",
      sourceId: source.id,
      desired: {
        title: source.title,
        description: source.description,
        content: source.content,
      },
    },
  ]);
  const duplicate = await client.getPrompt(duplicateId);
  expect(duplicate.useCount).toBe(0);
  expect(duplicate.lastUsedAt).toBeNull();
  const current = await client.getPrompt(source.id);
  await account.mutate([
    promptDeletion(current),
    use(source.id, promptUseFixtures.future),
  ]);
  await expect(client.getPrompt(source.id)).rejects.toThrow();
  const deleted = await client.getPrompts({ view: "recents" });
  expect(deleted.prompts.map((row) => row.id)).not.toContain(source.id);
});

test("malformed times and foreign identities cannot create usage", async () => {
  const account = await promptBrowser();
  const other = await promptBrowser();
  const create = promptOperation();
  await account.mutate([create]);
  for (const occurredAt of promptUseFixtures.invalidTimes) {
    const response = await post(
      "/api/v1/sync/mutations",
      { ...account.identity, operations: [use(create.promptId, occurredAt)] },
      { Cookie: account.Cookie }
    );
    expect(response.status).toBe(400);
  }
  const response = await other.mutate([
    use(create.promptId, promptUseFixtures.old),
  ]);
  expect(await response.json()).toMatchObject({
    results: [{ status: "rejected", error: { code: "not_found" } }],
  });
  const prompt = await promptClient(account.Cookie).getPrompt(create.promptId);
  expect(prompt.useCount).toBe(0);
});
