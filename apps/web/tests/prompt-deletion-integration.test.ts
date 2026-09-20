import { expect, test } from "bun:test";

import { deletionConflictFixture } from "@pr0/api-contract/prompt-fixtures";

import { post } from "./http-fixture";
import { seedCapacity } from "./prompt-capacity-fixture";
import {
  promptBrowser,
  promptClient,
  promptOperation,
  promptDeletion,
  promptEdit,
  promptState,
} from "./prompt-fixture";
import { withConflictStorageFailure } from "./prompt-storage-fixture";

test("permanent deletion removes the prompt, frees quota and replays without restoring its identity", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  const create = promptOperation();
  const created = await client.mutatePrompts({
    ...account.identity,
    operations: [create],
  });
  const source = await client.getPrompt(create.promptId);
  const deletion = {
    kind: "prompt.delete",
    operationId: crypto.randomUUID(),
    promptId: source.id,
    baseRevision: source.revision,
    dependsOn: [],
  };
  const send = () =>
    post(
      "/api/v1/sync/mutations",
      {
        ...account.identity,
        operations: [deletion],
      },
      { Cookie: account.Cookie }
    );
  const response = await send();
  expect(response.status).toBe(200);
  const receipt = await response.json();
  expect(receipt).toMatchObject({
    results: [{ status: "accepted", promptId: source.id }],
  });
  await expect(client.getPrompt(source.id)).rejects.toMatchObject({
    status: 404,
  });
  expect(await client.getPrompts()).toMatchObject({
    prompts: [],
    usage: { promptCount: 0, textBytes: 0 },
  });
  const replay = await send();
  expect(await replay.json()).toEqual(receipt);
  expect(
    await client.mutatePrompts({ ...account.identity, operations: [create] })
  ).toEqual(created);
  expect(
    await client.mutatePrompts({
      ...account.identity,
      operations: [{ ...create, operationId: crypto.randomUUID() }],
    })
  ).toMatchObject({
    results: [{ status: "rejected", error: { code: "identity_unavailable" } }],
  });
  await expect(client.getPrompt(source.id)).rejects.toMatchObject({
    status: 404,
  });
});

test.each(["delete-first", "edit-first"] as const)(
  "storage failure during %s preservation commits no partial effect and the exact operation remains retryable",
  async (order) => {
    const account = await promptBrowser();
    const client = promptClient(account.Cookie);
    const create = promptOperation(deletionConflictFixture.base);
    await account.mutate([create]);
    const base = await client.getPrompt(create.promptId);
    const deletion = promptDeletion(base);
    const edit = promptEdit(base, deletionConflictFixture.edited);
    await account.mutate([order === "delete-first" ? deletion : edit]);
    const envelope = {
      ...account.identity,
      operations: [order === "delete-first" ? edit : deletion],
    };
    const before = await client.getPrompts();
    await withConflictStorageFailure(async () => {
      expect(await client.mutatePrompts(envelope)).toMatchObject({
        results: [
          {
            status: "rejected",
            error: { code: "temporarily_unavailable", retryable: true },
          },
        ],
      });
      expect(await client.getPrompts()).toEqual(before);
      expect(await client.getConflicts()).toMatchObject({ notices: [] });
    });
    const result = await client.mutatePrompts(envelope);
    expect(result).toMatchObject({
      results: [{ status: "accepted", conflict: {} }],
    });
    expect(await client.mutatePrompts(envelope)).toEqual(result);
    await expect(client.getPrompt(base.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await client.getPrompts()).toMatchObject({
      usage: { promptCount: 1 },
    });
  }
);

test("stale deletion at the text quota preserves nothing until capacity is freed; identical retry then commits both effects", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  await seedCapacity(account.identity, "textBytes");
  const page = await client.getPrompts();
  const [first, second] = page.prompts;
  if (!first || !second) {
    throw new Error("Expected capacity prompts");
  }
  const base = await client.getPrompt(first.id);
  await account.mutate([
    promptEdit(base, {
      title: base.title,
      description: base.description,
      content: `${base.content.slice(0, -1)}y`,
    }),
  ]);
  const before = await client.getPrompts();
  const deletion = promptDeletion(base);
  const envelope = { ...account.identity, operations: [deletion] };
  expect(await client.mutatePrompts(envelope)).toMatchObject({
    results: [
      {
        status: "rejected",
        error: {
          code: "quota_exceeded",
          resource: "textBytes",
          retryable: true,
        },
      },
    ],
  });
  expect(await client.getPrompts()).toEqual(before);
  expect(await client.getPrompt(base.id)).toMatchObject({
    content: `${base.content.slice(0, -1)}y`,
  });
  expect(await client.getConflicts()).toMatchObject({ notices: [] });
  expect(
    await client.mutatePrompts({
      ...account.identity,
      operations: [{ ...deletion, baseRevision: "0" }],
    })
  ).toMatchObject({
    results: [
      { status: "rejected", error: { code: "operation_identity_reused" } },
    ],
  });
  await account.mutate([promptDeletion(second)]);
  expect(await client.mutatePrompts(envelope)).toMatchObject({
    results: [{ status: "accepted", conflict: {} }],
  });
  await expect(client.getPrompt(base.id)).rejects.toMatchObject({
    status: 404,
  });
});

test("post-deletion edits at the prompt quota remain actionable, and stale deletion uses resultant count", async () => {
  const account = await promptBrowser();
  const client = promptClient(account.Cookie);
  await seedCapacity(account.identity, "promptCount");
  const create = promptOperation();
  await account.mutate([create]);
  const base = await client.getPrompt(create.promptId);
  await account.mutate([promptDeletion(base), promptOperation()]);
  const envelope = {
    ...account.identity,
    operations: [promptEdit(base, { ...create.desired, content: "Unseen" })],
  };
  const before = await client.getPrompts();
  expect(await client.mutatePrompts(envelope)).toMatchObject({
    results: [
      {
        status: "rejected",
        error: { code: "quota_exceeded", resource: "promptCount" },
      },
    ],
  });
  expect(await client.getPrompts()).toEqual(before);
  const [other] = before.prompts;
  if (!other) {
    throw new Error("Expected capacity prompt");
  }
  const current = await client.getPrompt(other.id);
  await account.mutate([
    promptEdit(current, {
      title: current.title,
      description: current.description,
      content: "Unseen other",
    }),
  ]);
  expect(
    await client.mutatePrompts({
      ...account.identity,
      operations: [promptDeletion(current)],
    })
  ).toMatchObject({ results: [{ status: "accepted", conflict: {} }] });
  const preserved = await client.getPrompts();
  expect(preserved.usage.promptCount).toBe(10_000);
  const [, expendable] = preserved.prompts;
  if (!expendable) {
    throw new Error("Expected expendable prompt");
  }
  await account.mutate([promptDeletion(expendable)]);
  expect(await client.mutatePrompts(envelope)).toMatchObject({
    results: [{ status: "accepted", conflict: {} }],
  });
});

test("metadata-only changes do not require preservation, archived prompts delete, and ownership remains enforced", async () => {
  const owner = await promptBrowser();
  const other = await promptBrowser();
  const client = promptClient(owner.Cookie);
  const create = promptOperation();
  await owner.mutate([create]);
  const base = await client.getPrompt(create.promptId);
  expect(
    await promptClient(other.Cookie).mutatePrompts({
      ...other.identity,
      operations: [
        { ...promptDeletion(base), baseRevision: "0" },
        {
          ...promptEdit(base, { ...create.desired, content: "Foreign" }),
          baseRevision: "0",
        },
      ],
    })
  ).toMatchObject({
    results: [
      { status: "rejected", error: { code: "not_found" } },
      { status: "rejected", error: { code: "not_found" } },
    ],
  });
  await owner.mutate([
    promptState(base, "archived", true),
    promptState(base, "favorite", true),
  ]);
  const deletion = promptDeletion(base);
  const result = await client.mutatePrompts({
    ...owner.identity,
    operations: [deletion],
  });
  expect(result.results[0]).toMatchObject({ status: "accepted" });
  expect(result.results[0]).not.toHaveProperty("conflict");
  expect(await client.getPrompts({ view: "archive" })).toMatchObject({
    prompts: [],
    usage: { promptCount: 0, textBytes: 0 },
  });
  // Usage is not exposed by this slice; unsupported operations cannot recreate the identity.
  const usage = await post(
    "/api/v1/sync/mutations",
    {
      ...owner.identity,
      operations: [
        { ...deletion, kind: "prompt.use", operationId: crypto.randomUUID() },
      ],
    },
    { Cookie: owner.Cookie }
  );
  expect(usage.status).toBe(400);
  await expect(client.getPrompt(base.id)).rejects.toMatchObject({
    status: 404,
  });
  expect(await promptClient(other.Cookie).getPrompts()).toMatchObject({
    usage: { promptCount: 0 },
  });
});

test.each(["delete-first", "edit-first"] as const)(
  "unseen complete text survives %s and cannot be resurrected by replays or metadata",
  async (order) => {
    const account = await promptBrowser();
    const client = promptClient(account.Cookie);
    const create = promptOperation(deletionConflictFixture.base);
    await account.mutate([create]);
    const base = await client.getPrompt(create.promptId);
    const deletion = promptDeletion(base);
    const edit = promptEdit(base, deletionConflictFixture.edited);
    const operations =
      order === "delete-first" ? [deletion, edit] : [edit, deletion];
    const envelope = { ...account.identity, operations };
    const response = await client.mutatePrompts(envelope);
    const [, receipt] = response.results;
    expect(receipt).toMatchObject({
      status: "accepted",
      promptId: base.id,
      conflict: {},
    });
    if (
      receipt?.status !== "accepted" ||
      !("promptId" in receipt) ||
      !receipt.conflict
    ) {
      throw new Error("Expected preserved conflict copy");
    }
    const copy = await client.getPrompt(receipt.conflict.copyId);
    expect(copy).toMatchObject({
      ...deletionConflictFixture.copy,
      favorite: false,
      archived: false,
      useCount: 0,
      lastUsedAt: null,
      createdAt: receipt.acceptedAt,
      modifiedAt: receipt.acceptedAt,
    });
    await expect(client.getPrompt(base.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await client.getConflicts()).toMatchObject({
      notices: [{ originalId: base.id, copyId: copy.id, sourceTitle: "Reply" }],
    });
    expect(await client.mutatePrompts(envelope)).toEqual(response);
    expect(
      await client.mutatePrompts({
        ...account.identity,
        operations: [
          promptState(base, "favorite", true),
          promptState(base, "archived", false),
        ],
      })
    ).toMatchObject({
      results: [
        { status: "rejected", error: { code: "not_found" } },
        { status: "rejected", error: { code: "not_found" } },
      ],
    });
    const before = await client.getPrompts();
    await client.mutatePrompts({
      ...account.identity,
      operations: [promptDeletion(copy)],
    });
    expect(await client.mutatePrompts(envelope)).toEqual(response);
    await expect(client.getPrompt(copy.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(before.usage.promptCount).toBe(1);
    expect(await client.getPrompts()).toMatchObject({
      usage: { promptCount: 0, textBytes: 0 },
    });
  }
);
