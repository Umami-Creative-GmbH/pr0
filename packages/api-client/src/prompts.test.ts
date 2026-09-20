import { expect, test } from "bun:test";

import type {
  MutationEnvelope,
  MutationResult,
} from "@pr0/api-contract/prompts";

import { createApiClient } from "./client";

test("tag receipts accept equivalent mappings but reject mismatched identities and outcomes", async () => {
  const operation = {
    kind: "tag.create" as const,
    operationId: crypto.randomUUID(),
    tagId: crypto.randomUUID(),
    name: "Writing",
    baseRevision: "0",
    dependsOn: [],
  };
  const envelope: MutationEnvelope = {
    protocolVersion: 1,
    instanceId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    epoch: crypto.randomUUID(),
    installationId: crypto.randomUUID(),
    operations: [operation],
  };
  const receipt: Extract<MutationResult, { tagId: string }> = {
    status: "accepted",
    operationId: operation.operationId,
    tagId: operation.tagId,
    resolvedTagId: crypto.randomUUID(),
    outcome: "existing",
    revision: "1",
    acceptedAt: "2026-09-20T12:00:00.000Z",
  };
  const client = createApiClient({
    fetcher: () => Promise.resolve(Response.json({ results: [receipt] })),
  });
  expect(await client.mutatePrompts(envelope)).toEqual({ results: [receipt] });
  receipt.outcome = "created";
  await expect(client.mutatePrompts(envelope)).rejects.toThrow(
    "does not match"
  );
  receipt.outcome = "existing";
  await expect(
    client.mutatePrompts({
      ...envelope,
      operations: [{ ...operation, kind: "tag.rename" }],
    })
  ).rejects.toThrow("does not match");
  receipt.tagId = crypto.randomUUID();
  await expect(client.mutatePrompts(envelope)).rejects.toThrow(
    "does not match"
  );
});

test("organization reads validate scope, payloads, HTTP errors and cancellation", async () => {
  const scope = {
    instanceId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
  };
  const abort = new AbortController();
  let signal: AbortSignal | null | undefined;
  const client = createApiClient({
    fetcher: (_url, init) => {
      signal = init?.signal;
      return Promise.resolve(
        Response.json({
          ...scope,
          revision: "0",
          collections: [],
          tags: [],
          textBytes: 0,
        })
      );
    },
  });
  expect(await client.getOrganization(abort.signal, scope)).toMatchObject({
    collections: [],
  });
  expect(signal).toBe(abort.signal);
  await expect(
    client.getOrganization(undefined, {
      ...scope,
      accountId: crypto.randomUUID(),
    })
  ).rejects.toMatchObject({ status: 403 });
  const malformed = createApiClient({
    fetcher: () =>
      Promise.resolve(Response.json({ ...scope, collections: [] })),
  });
  await expect(malformed.getOrganization()).rejects.toThrow();
  const failed = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json(
          {
            code: "authentication_required",
            retryable: true,
            message: "Sign in.",
          },
          { status: 401 }
        )
      ),
  });
  await expect(failed.getOrganization()).rejects.toMatchObject({ status: 401 });
});

test("collection mutation receipts must match the collection and operation identities", async () => {
  const operation = {
    kind: "collection.create" as const,
    operationId: crypto.randomUUID(),
    collectionId: crypto.randomUUID(),
    baseRevision: "0",
    dependsOn: [],
    name: "Work",
  };
  const envelope: MutationEnvelope = {
    protocolVersion: 1,
    instanceId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    epoch: crypto.randomUUID(),
    installationId: crypto.randomUUID(),
    operations: [operation],
  };
  const client = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json({
          results: [
            {
              status: "accepted",
              operationId: operation.operationId,
              collectionId: crypto.randomUUID(),
              revision: "1",
              acceptedAt: "2026-09-20T12:00:00.000Z",
            },
          ],
        })
      ),
  });
  await expect(client.mutatePrompts(envelope)).rejects.toThrow(
    "does not match"
  );
});

test("prompt client rejects HTTP errors and malformed successful responses", async () => {
  const failing = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json(
          {
            code: "results_changed",
            message: "Refresh the list.",
            retryable: true,
          },
          { status: 409 }
        )
      ),
  });
  await expect(failing.getPrompts()).rejects.toMatchObject({
    status: 409,
    detail: { code: "results_changed" },
  });
  const malformed = createApiClient({
    fetcher: () => Promise.resolve(Response.json({ prompts: [] })),
  });
  await expect(malformed.getPrompts()).rejects.toThrow();
});

test("archive requests send the selected scope and reject invalid lifecycle payloads before fetch", async () => {
  let url = "";
  const client = createApiClient({
    fetcher: (input) => {
      url = String(input);
      return Promise.resolve(
        Response.json({
          instanceId: crypto.randomUUID(),
          accountId: crypto.randomUUID(),
          revision: "0",
          prompts: [],
          nextCursor: null,
          usage: { promptCount: 0, textBytes: 0 },
        })
      );
    },
  });
  await client.getPrompts({ view: "archive", limit: 2 });
  expect(url).toBe("/api/v1/library/prompts?limit=2&view=archive");
  const envelope: MutationEnvelope = {
    protocolVersion: 1,
    instanceId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    epoch: crypto.randomUUID(),
    installationId: crypto.randomUUID(),
    operations: [
      {
        kind: "prompt.duplicate",
        operationId: crypto.randomUUID(),
        promptId: crypto.randomUUID(),
        baseRevision: "0",
        dependsOn: [],
        sourceId: "bad-id",
        desired: { title: "Source", description: "", content: "Text" },
      },
    ],
  };
  await expect(client.mutatePrompts(envelope)).rejects.toThrow();
  expect(url).toBe("/api/v1/library/prompts?limit=2&view=archive");
});

test.each(["duplicate", "delete"] as const)(
  "%s requests preserve cancellation, typed HTTP failures and reject a mismatched success receipt",
  async (action) => {
    const operation = {
      kind: "prompt.duplicate" as const,
      operationId: crypto.randomUUID(),
      promptId: crypto.randomUUID(),
      baseRevision: "0",
      dependsOn: [],
      sourceId: crypto.randomUUID(),
      desired: { title: "Source", description: "", content: "Text" },
    };
    const envelope: MutationEnvelope = {
      protocolVersion: 1,
      instanceId: crypto.randomUUID(),
      accountId: crypto.randomUUID(),
      epoch: crypto.randomUUID(),
      installationId: crypto.randomUUID(),
      operations: [
        action === "duplicate"
          ? operation
          : {
              kind: "prompt.delete",
              operationId: operation.operationId,
              promptId: operation.promptId,
              baseRevision: operation.baseRevision,
              dependsOn: [],
            },
      ],
    };
    const controller = new AbortController();
    controller.abort();
    const cancelled = createApiClient({
      fetcher: (_input, init) => {
        init?.signal?.throwIfAborted();
        return Promise.resolve(Response.json({}));
      },
    });
    await expect(
      cancelled.mutatePrompts(envelope, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    const failed = createApiClient({
      fetcher: () =>
        Promise.resolve(
          Response.json(
            { code: "rate_limited", message: "Retry later", retryable: true },
            { status: 429 }
          )
        ),
    });
    await expect(failed.mutatePrompts(envelope)).rejects.toMatchObject({
      status: 429,
      detail: { code: "rate_limited" },
    });
    const mismatched = createApiClient({
      fetcher: () =>
        Promise.resolve(
          Response.json({
            results: [
              {
                status: "accepted",
                operationId: operation.operationId,
                promptId: operation.sourceId,
                revision: "1",
                acceptedAt: "2026-09-20T12:00:00.000Z",
              },
            ],
          })
        ),
    });
    await expect(mismatched.mutatePrompts(envelope)).rejects.toThrow(
      "does not match"
    );
  }
);

test("prompt reads reject another account's response before it enters the caller's view", async () => {
  const expected = {
    accountId: "00000000-0000-4000-8000-000000000001",
    instanceId: "00000000-0000-4000-8000-000000000002",
  };
  const client = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json({
          ...expected,
          accountId: "00000000-0000-4000-8000-000000000003",
          revision: "0",
          prompts: [],
          nextCursor: null,
          usage: { promptCount: 0, textBytes: 0 },
        })
      ),
  });
  await expect(
    client.getPrompts({}, undefined, expected)
  ).rejects.toMatchObject({ status: 403, detail: { code: "forbidden" } });
});

test("prompt requests validate inputs and forward cancellation to authenticated fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = createApiClient({
    fetcher: (_url, init) => {
      expect(init.credentials).toBe("same-origin");
      expect(init.redirect).toBe("error");
      init.signal?.throwIfAborted();
      return Promise.resolve(Response.json({}));
    },
  });
  await expect(client.getPrompts({}, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(client.getPrompt("not-a-uuid")).rejects.toThrow();
});

test("conflict reads validate scope, HTTP failures, payloads, pagination input and cancellation", async () => {
  const scope = {
    instanceId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
  };
  const client = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json({ ...scope, notices: [], nextCursor: null })
      ),
  });
  expect(await client.getConflicts({}, undefined, scope)).toMatchObject({
    notices: [],
  });
  await expect(
    client.getConflicts({}, undefined, {
      ...scope,
      accountId: crypto.randomUUID(),
    })
  ).rejects.toMatchObject({ status: 403 });
  await expect(client.getConflicts({ limit: 101 })).rejects.toThrow();
  const malformed = createApiClient({
    fetcher: () => Promise.resolve(Response.json({ notices: [] })),
  });
  await expect(malformed.getConflicts()).rejects.toThrow();
  const failed = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json(
          {
            code: "temporarily_unavailable",
            message: "Retry later",
            retryable: true,
          },
          { status: 503 }
        )
      ),
  });
  await expect(failed.getConflicts()).rejects.toMatchObject({ status: 503 });
  const controller = new AbortController();
  controller.abort();
  const aborted = createApiClient({
    fetcher: (_url, init) => {
      init.signal?.throwIfAborted();
      return Promise.resolve(Response.json({}));
    },
  });
  await expect(
    aborted.getConflicts({}, controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
});
