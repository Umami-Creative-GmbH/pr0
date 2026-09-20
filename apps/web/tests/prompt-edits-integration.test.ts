import { expect, test } from "bun:test";

import { createPromptClient } from "@pr0/api-client/prompts";
import { competingPromptEdits } from "@pr0/api-contract/prompt-fixtures";
import { conflictCopyTitle } from "@pr0/api-contract/prompts";

import { origin } from "./http-fixture";
import { seedCapacity } from "./prompt-capacity-fixture";
import {
  promptBrowser,
  promptOperation,
  promptClient,
  promptEdit,
} from "./prompt-fixture";
import { withConflictStorageFailure } from "./prompt-storage-fixture";

test("two public clients combine independent title and content edits", async () => {
  const account = await promptBrowser();
  const client = () =>
    createPromptClient(origin, (url, init) => {
      const headers = new Headers(init.headers);
      headers.set("Cookie", account.Cookie);
      headers.set("Origin", origin);
      return fetch(url, { ...init, headers });
    });
  const a = client();
  const b = client();
  const create = promptOperation();
  await a.mutatePrompts({ ...account.identity, operations: [create] });
  const base = await b.getPrompt(create.promptId);
  const update = (field: "title" | "content", value: string) => ({
    operationId: crypto.randomUUID(),
    kind: "prompt.update" as const,
    promptId: base.id,
    baseRevision: base.revision,
    dependsOn: [],
    changedFields: [field],
    base: {
      title: base.title,
      description: base.description,
      content: base.content,
    },
    desired: {
      title: base.title,
      description: base.description,
      content: base.content,
      [field]: value,
    },
  });
  await a.mutatePrompts({
    ...account.identity,
    operations: [update("title", "A title")],
  });
  await b.mutatePrompts({
    ...account.identity,
    installationId: crypto.randomUUID(),
    operations: [update("content", "B content")],
  });
  expect(await a.getPrompt(base.id)).toMatchObject({
    title: "A title",
    content: "B content",
    revision: "3",
  });
  expect(await b.getPrompts()).toMatchObject({ usage: { promptCount: 1 } });
});

test("unchanged and equal desired saves preserve modification time; genuine edits advance it", async () => {
  const account = await promptBrowser();
  const a = promptClient(account.Cookie);
  const b = promptClient(account.Cookie);
  const create = promptOperation();
  await a.mutatePrompts({ ...account.identity, operations: [create] });
  const base = await b.getPrompt(create.promptId);
  await b.mutatePrompts({
    ...account.identity,
    operations: [promptEdit(base, create.desired)],
  });
  expect(await a.getPrompt(base.id)).toEqual(base);
  const desired = { ...create.desired, content: "same desired" };
  await a.mutatePrompts({
    ...account.identity,
    operations: [promptEdit(base, desired)],
  });
  const changed = await a.getPrompt(base.id);
  expect(Date.parse(changed.modifiedAt)).toBeGreaterThan(
    Date.parse(base.modifiedAt)
  );
  await b.mutatePrompts({
    ...account.identity,
    operations: [promptEdit(base, desired)],
  });
  expect(await b.getPrompt(base.id)).toEqual(changed);
  const notices = await b.getConflicts();
  expect(notices.notices).toEqual([]);
});

test("long conflict titles, tied-revision pages and old receipt replay retain every variant", async () => {
  const account = await promptBrowser();
  const a = promptClient(account.Cookie);
  const b = promptClient(account.Cookie);
  const create = promptOperation({
    title: "Original",
    description: "",
    content: "old",
  });
  await a.mutatePrompts({ ...account.identity, operations: [create] });
  const base = await b.getPrompt(create.promptId);
  await a.mutatePrompts({
    ...account.identity,
    operations: [promptEdit(base, { ...create.desired, content: "A" })],
  });
  const title = "🌍".repeat(200);
  const envelope = {
    ...account.identity,
    operations: [
      promptEdit(base, { title, description: "B context", content: "B1" }),
    ],
  };
  const result = await b.mutatePrompts(envelope);
  const [receipt] = result.results;
  if (receipt?.status !== "accepted" || !receipt.conflict) {
    throw new Error("Expected conflict mapping");
  }
  const copy = await b.getPrompt(receipt.conflict.copyId);
  expect(copy).toMatchObject({
    title: `${"🌍".repeat(184)} (conflict copy)`,
    content: "B1",
    favorite: false,
    archived: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: receipt.acceptedAt,
    modifiedAt: receipt.acceptedAt,
  });
  expect(copy.createdAt).not.toBe(base.createdAt);
  const notices = await a.getConflicts();
  expect(notices.notices).toEqual([
    {
      id: receipt.conflict.noticeId,
      originalId: base.id,
      copyId: copy.id,
      sourceTitle: title,
      revision: receipt.revision,
      createdAt: receipt.acceptedAt,
    },
  ]);
  const first = await a.getPrompts({ limit: 1 });
  const second = await b.getPrompts({
    limit: 1,
    cursor: first.nextCursor ?? undefined,
  });
  expect(
    new Set([...first.prompts, ...second.prompts].map((prompt) => prompt.id))
  ).toEqual(new Set([base.id, copy.id]));
  expect(first.usage.textBytes).toBe(2373);
  await b.mutatePrompts({
    ...account.identity,
    operations: [
      promptEdit(copy, {
        title: conflictCopyTitle(title),
        description: "B context",
        content: "B2",
      }),
    ],
  });
  expect(await b.mutatePrompts(envelope)).toEqual(result);
  expect(await a.getPrompt(copy.id)).toMatchObject({ content: "B2" });
  const other = await promptBrowser();
  const otherClient = promptClient(other.Cookie);
  expect(await otherClient.getConflicts()).toMatchObject({ notices: [] });
  await expect(otherClient.getPrompt(copy.id)).rejects.toMatchObject({
    status: 404,
  });
});

test("capacity refusal keeps original, notices and quota unchanged and freezes the transmitted identity", async () => {
  const account = await promptBrowser();
  await seedCapacity(account.identity, "promptCount");
  const a = promptClient(account.Cookie);
  const b = promptClient(account.Cookie);
  const create = promptOperation({
    title: "Reply",
    description: "",
    content: "old",
  });
  await a.mutatePrompts({ ...account.identity, operations: [create] });
  const base = await b.getPrompt(create.promptId);
  await a.mutatePrompts({
    ...account.identity,
    operations: [
      promptEdit(base, { title: "Reply", description: "", content: "A" }),
    ],
  });
  const before = await a.getPrompts();
  const original = await a.getPrompt(base.id);
  const edit = promptEdit(base, {
    title: "Independent title",
    description: "",
    content: "B",
  });
  const envelope = { ...account.identity, operations: [edit] };
  const refused = await b.mutatePrompts(envelope);
  expect(refused.results[0]).toMatchObject({
    status: "rejected",
    error: { code: "quota_exceeded", resource: "promptCount" },
  });
  expect(await a.getPrompts()).toEqual(before);
  expect(await a.getPrompt(base.id)).toEqual(original);
  const conflicts = await b.getConflicts();
  expect(conflicts.notices).toEqual([]);
  const corrected = { ...edit, desired: { ...edit.desired, content: "A" } };
  const reused = await b.mutatePrompts({
    ...account.identity,
    operations: [corrected],
  });
  expect(reused.results[0]).toMatchObject({
    status: "rejected",
    error: { code: "operation_identity_reused" },
  });
  const correction = await b.mutatePrompts({
    ...account.identity,
    operations: [{ ...corrected, operationId: crypto.randomUUID() }],
  });
  expect(correction.results[0]).toMatchObject({ status: "accepted" });
});

test("competing text preserves the full incoming variant once while independent fields combine", async () => {
  const account = await promptBrowser();
  const a = promptClient(account.Cookie);
  const b = promptClient(account.Cookie);
  const fixture = competingPromptEdits;
  const create = promptOperation(fixture.base);
  await a.mutatePrompts({ ...account.identity, operations: [create] });
  const base = await b.getPrompt(create.promptId);
  await a.mutatePrompts({
    ...account.identity,
    operations: [promptEdit(base, fixture.first)],
  });
  const envelope = {
    ...account.identity,
    installationId: crypto.randomUUID(),
    operations: [promptEdit(base, fixture.incoming)],
  };
  const receipt = await b.mutatePrompts(envelope);
  expect(receipt.results[0]).toMatchObject({ status: "accepted" });
  expect(await a.getPrompt(base.id)).toMatchObject(fixture.original);
  const page = await b.getPrompts();
  expect(page.usage.promptCount).toBe(2);
  const copy = page.prompts.find((prompt) => prompt.id !== base.id);
  expect(copy).toBeDefined();
  if (!copy) {
    throw new Error("Expected preserved copy");
  }
  expect(await b.getPrompt(copy.id)).toMatchObject(fixture.copy);
  expect(await b.mutatePrompts(envelope)).toEqual(receipt);
  const after = await a.getPrompts();
  expect(after.usage.promptCount).toBe(2);
});

test("a storage failure during preservation rolls back the original, copy, counters and receipt", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const fixture = competingPromptEdits;
  const create = promptOperation(fixture.base);
  await client.mutatePrompts({ ...account.identity, operations: [create] });
  const base = await client.getPrompt(create.promptId);
  await client.mutatePrompts({
    ...account.identity,
    operations: [promptEdit(base, fixture.first)],
  });
  const before = await client.getPrompts();
  const original = await client.getPrompt(base.id);
  const envelope = {
    ...account.identity,
    operations: [promptEdit(base, fixture.incoming)],
  };
  await withConflictStorageFailure(async () => {
    expect(await client.mutatePrompts(envelope)).toMatchObject({
      results: [
        { status: "rejected", error: { code: "temporarily_unavailable" } },
      ],
    });
    expect(await client.getPrompts()).toEqual(before);
    expect(await client.getPrompt(base.id)).toEqual(original);
    expect(await client.getConflicts()).toMatchObject({ notices: [] });
  });
  const receipt = await client.mutatePrompts(envelope);
  expect(receipt).toMatchObject({ results: [{ status: "accepted" }] });
  expect(await client.mutatePrompts(envelope)).toEqual(receipt);
  expect(await client.getPrompts()).toMatchObject({
    usage: { promptCount: 2 },
  });
});

test("text-byte capacity refuses a conflict atomically while usage-reducing edits remain possible", async () => {
  const account = await promptBrowser();
  await seedCapacity(account.identity, "textBytes");
  const a = promptClient(account.Cookie);
  const b = promptClient(account.Cookie);
  const page = await a.getPrompts({ limit: 1 });
  const [summary] = page.prompts;
  if (!summary) {
    throw new Error("Expected capacity fixture prompt");
  }
  const base = await b.getPrompt(summary.id);
  await a.mutatePrompts({
    ...account.identity,
    operations: [
      promptEdit(base, {
        title: base.title,
        description: "",
        content: `A${base.content.slice(1)}`,
      }),
    ],
  });
  const before = await a.getPrompts();
  const original = await a.getPrompt(base.id);
  const envelope = {
    ...account.identity,
    operations: [
      promptEdit(base, { title: base.title, description: "", content: "B" }),
    ],
  };
  expect(await b.mutatePrompts(envelope)).toMatchObject({
    results: [
      {
        status: "rejected",
        error: { code: "quota_exceeded", resource: "textBytes" },
      },
    ],
  });
  expect(await a.getPrompts()).toEqual(before);
  expect(await a.getPrompt(base.id)).toEqual(original);
  await a.mutatePrompts({
    ...account.identity,
    operations: [
      promptEdit(original, {
        title: base.title,
        description: "",
        content: "A",
      }),
    ],
  });
  expect(await b.mutatePrompts(envelope)).toMatchObject({
    results: [{ status: "accepted" }],
  });
  expect(await a.getConflicts()).toMatchObject({
    notices: [{ originalId: base.id }],
  });
});
