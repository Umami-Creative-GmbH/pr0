import { expect, test } from "bun:test";

import {
  invalidPromptTextFixtures,
  maximumPromptText,
} from "@pr0/api-contract/prompt-fixtures";
import {
  mutationResponseSchema,
  promptPageSchema,
} from "@pr0/api-contract/prompts";

import { socialBrowser } from "./email-change-fixture";
import { origin, post } from "./http-fixture";
import { promptBrowser, promptOperation } from "./prompt-fixture";
import { libraryFor, statusOf } from "./social-fixture";

const responseBody = async (response: Promise<Response>) => {
  const result = await response;
  return result.json();
};

test("a verified author creates a prompt, replays a lost response and reopens exact content", async () => {
  const browser = await socialBrowser();
  const library = await libraryFor(browser.Cookie);
  const operationId = crypto.randomUUID();
  const promptId = crypto.randomUUID();
  const envelope = {
    protocolVersion: 1,
    instanceId: library.instance.id,
    accountId: library.account.id,
    epoch: library.epoch,
    installationId: crypto.randomUUID(),
    operations: [
      {
        operationId,
        kind: "prompt.create",
        promptId,
        baseRevision: "0",
        dependsOn: [],
        desired: {
          title: "  Writing helper  ",
          description: "  Context  ",
          content: "  Hello 🌍\n\tKeep indentation\n ",
        },
      },
    ],
  };
  const response = await post("/api/v1/sync/mutations", envelope, {
    Cookie: browser.Cookie,
  });
  expect(response.status).toBe(200);
  const outcome = await response.json();
  expect(outcome.results[0]).toMatchObject({
    status: "accepted",
    operationId,
    promptId,
    revision: "1",
  });
  const replay = await post("/api/v1/sync/mutations", envelope, {
    Cookie: browser.Cookie,
  });
  expect(await replay.json()).toEqual(outcome);
  const detail = await fetch(`${origin}/api/v1/library/prompts/${promptId}`, {
    headers: { Cookie: browser.Cookie },
  });
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({
    id: promptId,
    title: "Writing helper",
    description: "Context",
    content: "  Hello 🌍\n\tKeep indentation\n ",
    revision: "1",
  });
  const list = await fetch(`${origin}/api/v1/library/prompts`, {
    headers: { Cookie: browser.Cookie },
  });
  expect(await list.json()).toMatchObject({
    revision: "1",
    prompts: [{ id: promptId, title: "Writing helper" }],
    nextCursor: null,
    usage: { promptCount: 1 },
  });
});

test("public mutation admission rejects oversized, malformed and incompatible envelopes", async () => {
  const browser = await promptBrowser();
  const envelope = { ...browser.identity, operations: [promptOperation()] };
  const unsupported = await post(
    "/api/v1/sync/mutations",
    { ...envelope, protocolVersion: 2 },
    { Cookie: browser.Cookie }
  );
  expect(unsupported.status).toBe(400);
  const oversized = await browser.mutate([
    promptOperation({
      title: "t",
      description: "",
      content: "x".repeat(4_194_304),
    }),
  ]);
  expect(oversized.status).toBe(413);
  const tooMany = await browser.mutate(
    Array.from({ length: 101 }, () => promptOperation())
  );
  expect(tooMany.status).toBe(400);
  const oldEpoch = await browser.mutate([promptOperation()], {
    epoch: crypto.randomUUID(),
  });
  expect(await oldEpoch.json()).toMatchObject({
    results: [{ error: { code: "snapshot_required" } }],
  });
  const unchanged = await browser.get("");
  expect(await unchanged.json()).toMatchObject({
    revision: "0",
    usage: { promptCount: 0, textBytes: 0 },
  });
});

test("scalar and byte limits reject exact field errors without truncation; maximum Unicode content survives", async () => {
  const browser = await promptBrowser();
  const operations = invalidPromptTextFixtures.map((fixture) =>
    promptOperation({
      title: "Valid",
      description: "",
      content: "Valid",
      [fixture.field]: fixture.value,
    })
  );
  const response = await browser.mutate(operations);
  const { results } = mutationResponseSchema.parse(await response.json());
  for (const [index, result] of results.entries()) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.fields).toHaveProperty(
        invalidPromptTextFixtures[index]?.field ?? "missing fixture"
      );
    }
  }
  const maximum = promptOperation(maximumPromptText);
  const accepted = await browser.mutate([
    maximum,
    promptOperation(maximumPromptText),
  ]);
  const acceptedBody = await accepted.json();
  expect(
    acceptedBody.results.map((result: { status: string }) => result.status)
  ).toEqual(["accepted", "accepted"]);
  expect(await responseBody(browser.get(`/${maximum.promptId}`))).toMatchObject(
    maximumPromptText
  );
  expect(await responseBody(browser.get(""))).toMatchObject({
    usage: { promptCount: 2, textBytes: 541_888 },
  });
});

test("foreign identities, foreign details, invalid origin and absent sessions cannot access prompts", async () => {
  const [owner, other] = await Promise.all([promptBrowser(), promptBrowser()]);
  const operation = promptOperation();
  await owner.mutate([operation]);
  expect(await statusOf(other.get(`/${operation.promptId}`))).toBe(404);
  const denied = await other.mutate([promptOperation()], {
    accountId: owner.identity.accountId,
  });
  expect(await denied.json()).toMatchObject({
    results: [{ error: { code: "forbidden" } }],
  });
  expect(await statusOf(fetch(`${origin}/api/v1/library/prompts`))).toBe(401);
  const forged = await post(
    "/api/v1/sync/mutations",
    { ...owner.identity, operations: [promptOperation()] },
    { Cookie: owner.Cookie, Origin: "https://foreign.example" }
  );
  expect(forged.status).toBe(403);
  expect(await statusOf(other.get("?accountId=foreign"))).toBe(400);
});

test("concurrent duplicate delivery has one effect and changed payload or prompt identity cannot be reused", async () => {
  const browser = await promptBrowser();
  const operation = promptOperation();
  const replies = await Promise.all([
    browser.mutate([operation]),
    browser.mutate([operation]),
  ]);
  const bodies = await Promise.all(replies.map((response) => response.json()));
  expect(bodies[0]).toEqual(bodies[1]);
  const changed = await browser.mutate([
    { ...operation, desired: { ...operation.desired, content: "Changed" } },
  ]);
  expect(await changed.json()).toMatchObject({
    results: [{ error: { code: "operation_identity_reused" } }],
  });
  const invalidReuse = await browser.mutate([
    { ...operation, desired: { ...operation.desired, content: "\u0000" } },
  ]);
  expect(await invalidReuse.json()).toMatchObject({
    results: [{ error: { code: "operation_identity_reused" } }],
  });
  const reused = await browser.mutate([
    { ...operation, operationId: crypto.randomUUID() },
  ]);
  expect(await reused.json()).toMatchObject({
    results: [{ error: { code: "identity_unavailable" } }],
  });
  const blocked = await browser.mutate([
    { ...promptOperation(), dependsOn: [crypto.randomUUID()] },
    promptOperation(),
  ]);
  const blockedBody = await blocked.json();
  expect(
    blockedBody.results.map((result: { status: string }) => result.status)
  ).toEqual(["rejected", "accepted"]);
  expect(await responseBody(browser.get(""))).toMatchObject({
    revision: "2",
    usage: { promptCount: 2 },
  });
});

test("every prompt is reachable in bounded pages; signed cursors reject changed libraries and other accounts", async () => {
  const browser = await promptBrowser();
  const operations = Array.from({ length: 12 }, () => promptOperation());
  await browser.mutate(operations);
  const first = promptPageSchema.parse(
    await responseBody(browser.get("?limit=7"))
  );
  expect(first.prompts).toHaveLength(7);
  expect(first.prompts[0]).not.toHaveProperty("content");
  const second = promptPageSchema.parse(
    await responseBody(browser.get(`?limit=7&cursor=${first.nextCursor}`))
  );
  expect(second.prompts).toHaveLength(5);
  expect(second.nextCursor).toBeNull();
  expect(
    new Set([...first.prompts, ...second.prompts].map((prompt) => prompt.id))
      .size
  ).toBe(12);
  const other = await promptBrowser();
  expect(await statusOf(other.get(`?limit=7&cursor=${first.nextCursor}`))).toBe(
    400
  );
  expect(
    await statusOf(browser.get(`?limit=7&cursor=${first.nextCursor}tampered`))
  ).toBe(400);
  await browser.mutate([promptOperation()]);
  expect(
    await responseBody(browser.get(`?limit=7&cursor=${first.nextCursor}`))
  ).toMatchObject({ code: "results_changed" });
});
