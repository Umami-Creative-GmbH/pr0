import { expect, test } from "bun:test";

import { createApiClient } from "./client";

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
