// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Keep each batch's identities stable until the public endpoint acknowledges it.
import assert from "node:assert/strict";

import {
  mutationResponseSchema,
  promptPageSchema,
  utf8Bytes,
} from "@pr0/api-contract/prompts";
import type { MutationEnvelope } from "@pr0/api-contract/prompts";

import { capacityPhrase } from "./capacity-corpus";
import type { CapacityServiceInstance } from "./capacity-service-fixture";

export const measureCapacityCatchUp = async (
  instance: CapacityServiceInstance,
  cookie: string
) => {
  const library = await instance.library(cookie);
  const operations = Array.from({ length: 1000 }, (_, index) => {
    const title = `Catch-up ${String(index).padStart(4, "0")}`;
    const bytes = 10_485 + Number(index < 760);
    return {
      kind: "prompt.create" as const,
      operationId: crypto.randomUUID(),
      promptId: crypto.randomUUID(),
      baseRevision: "0",
      dependsOn: [],
      desired: {
        title,
        description: "",
        content:
          capacityPhrase +
          "x".repeat(bytes - utf8Bytes(title) - utf8Bytes(capacityPhrase)),
      },
    };
  });
  assert.equal(
    operations.reduce(
      (sum, operation) =>
        sum + utf8Bytes(operation.desired.title + operation.desired.content),
      0
    ),
    10_485_760
  );
  const identity = {
    protocolVersion: 1 as const,
    instanceId: library.instance.id,
    accountId: library.account.id,
    epoch: library.epoch,
    installationId: crypto.randomUUID(),
  };
  const started = performance.now();
  let throttled = 0;
  for (let offset = 0; offset < operations.length; offset += 100) {
    const batch = operations.slice(offset, offset + 100);
    const envelope: MutationEnvelope = { ...identity, operations: batch };
    assert.ok(utf8Bytes(JSON.stringify(envelope)) <= 4_194_304);
    while (true) {
      const response = await instance.request(
        "/api/v1/sync/mutations",
        envelope,
        cookie
      );
      if (response.status === 429 || response.status === 503) {
        const delay = Number(response.headers.get("Retry-After"));
        assert.ok(
          delay > 0 && performance.now() - started < 120_000,
          "Catch-up stalled without a bounded retry"
        );
        throttled += 1;
        await response.body?.cancel();
        await Bun.sleep(delay * 1000);
        continue;
      }
      assert.equal(response.status, 200, await response.clone().text());
      const result = mutationResponseSchema.parse(await response.json());
      assert.equal(result.results.length, batch.length);
      for (const [index, receipt] of result.results.entries()) {
        assert.ok(
          receipt.status === "accepted" &&
            receipt.operationId === batch[index]?.operationId,
          "Catch-up has unacknowledged work"
        );
      }
      break;
    }
  }
  const elapsedMs = performance.now() - started;
  const ids = new Set<string>();
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ query: "Catch-up", limit: "100" });
    if (cursor) {
      params.set("cursor", cursor);
    }
    const response = await instance.request(
      `/api/v1/library/prompts?${params}`,
      undefined,
      cookie
    );
    if (!response.ok) {
      assert.ok(
        response.status === 503 && performance.now() - started < 300_000
      );
      await response.body?.cancel();
      await Bun.sleep(1000);
      continue;
    }
    const page = promptPageSchema.parse(await response.json());
    for (const prompt of page.prompts) {
      assert.ok(!ids.has(prompt.id));
      ids.add(prompt.id);
    }
    cursor = page.nextCursor;
  } while (cursor || ids.size === 0);
  assert.equal(ids.size, 1000);
  for (const operation of operations) {
    assert.ok(ids.has(operation.promptId));
  }
  return {
    elapsedMs,
    acknowledged: operations.length,
    logicalTextBytes: 10_485_760,
    throttled,
    classification:
      "REST delivery of queued creates; does not measure the native durable outbox or shaped online network",
  };
};
