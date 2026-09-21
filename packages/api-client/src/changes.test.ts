import { expect, test } from "bun:test";

import type { ChangePage } from "@pr0/api-contract/changes";

import fixture from "../../api-contract/src/change-fixtures.json";
import { createChangeClient } from "./changes";

const scope = {
  instanceId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  epoch: "00000000-0000-4000-8000-000000000003",
};

const page: ChangePage = {
  ...scope,
  version: 1,
  normalization: "pr0-search-v1-ucd17",
  fromRevision: "4",
  revision: "4",
  headRevision: "4",
  cursor: "opaque-cursor",
  changes: [],
  hasMore: false,
};
test("shared complete events validate while partial, foreign and gapped pages are rejected", async () => {
  const client = createChangeClient("https://example.test", fixture, () =>
    Promise.resolve(Response.json(fixture))
  );
  const result = await client.poll({ after: "2", epoch: fixture.epoch });
  expect(result.changes[0]?.prompts[0]?.content).toBe("Remote content");
  const malformed = [
    { ...fixture, changes: [], hasMore: true },
    { ...fixture, fromRevision: "1" },
    { ...fixture, accountId: scope.accountId },
    { ...fixture, epoch: scope.epoch },
    {
      ...fixture,
      changes: [
        {
          ...fixture.changes[0],
          deletedPromptIds: ["66666666-6666-4666-8666-666666666666"],
        },
      ],
    },
  ];
  for (const body of malformed) {
    const invalid = createChangeClient("https://example.test", fixture, () =>
      Promise.resolve(Response.json(body))
    );
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each independent malformed wire page must be rejected.
    await expect(invalid.poll()).rejects.toThrow();
  }
});

test("HTTP retry guidance and explicit recovery survive client validation", async () => {
  const client = createChangeClient("https://example.test", scope, () =>
    Promise.resolve(
      Response.json(
        { code: "snapshot_required", message: "Recover", retryable: false },
        { status: 409 }
      )
    )
  );
  await expect(client.poll()).rejects.toMatchObject({
    status: 409,
    detail: { code: "snapshot_required" },
  });
  const limited = createChangeClient("https://example.test", scope, () =>
    Promise.resolve(
      Response.json(
        { code: "rate_limited", message: "Wait", retryable: true },
        { status: 429, headers: { "Retry-After": "13" } }
      )
    )
  );
  await expect(limited.poll()).rejects.toMatchObject({
    detail: { retryAfter: 13 },
  });
});

test("cancellation rejects a late response even when transport ignores abort", async () => {
  const pending = Promise.withResolvers<Response>();
  const controller = new AbortController();
  const client = createChangeClient(
    "https://example.test",
    scope,
    () => pending.promise
  );
  const result = client.poll({}, controller.signal);
  controller.abort();
  pending.resolve(Response.json(page));
  await expect(result).rejects.toThrow();
});

test("the change client validates a scoped checkpoint and requests a bounded poll", async () => {
  let requested = "";
  const client = createChangeClient("https://example.test", scope, (url) => {
    requested = url;
    return Promise.resolve(Response.json(page));
  });
  expect(await client.poll({ after: "4", epoch: scope.epoch })).toEqual(page);
  expect(new URL(requested).searchParams.get("wait")).toBe("25");
  expect(new URL(requested).searchParams.get("after")).toBe("4");
});

test("an initial web checkpoint omits an absent cursor", async () => {
  let requested = "";
  const client = createChangeClient("https://example.test", scope, (url) => {
    requested = url;
    return Promise.resolve(Response.json(page));
  });
  await client.poll({ cursor: undefined, wait: 0 });
  expect(new URL(requested).searchParams.has("cursor")).toBe(false);
});
