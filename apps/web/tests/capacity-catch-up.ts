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

const deliverCapacityBatch = async (
  instance: CapacityServiceInstance,
  cookie: string,
  identity: Omit<MutationEnvelope, "operations">,
  operations: MutationEnvelope["operations"],
  started: number
) => {
  let pending = operations;
  let throttled = 0;
  while (pending.length) {
    assert.ok(
      performance.now() - started < 120_000,
      "Catch-up retry deadline exceeded"
    );
    const envelope: MutationEnvelope = { ...identity, operations: pending };
    assert.ok(utf8Bytes(JSON.stringify(envelope)) <= 4_194_304);
    const response = await instance.request(
      "/api/v1/sync/mutations",
      envelope,
      cookie
    );
    let delay = 0;
    if (response.status === 429 || response.status === 503) {
      delay = Number(response.headers.get("Retry-After"));
      assert.ok(delay > 0, "Catch-up refusal needs a bounded retry delay");
      await response.body?.cancel();
    } else {
      assert.equal(response.status, 200, await response.clone().text());
      const result = mutationResponseSchema.parse(await response.json());
      assert.equal(result.results.length, pending.length);
      const retry: MutationEnvelope["operations"] = [];
      for (const [index, receipt] of result.results.entries()) {
        const operation = pending[index];
        assert.ok(operation);
        if (receipt.status === "accepted") {
          assert.equal(receipt.operationId, operation.operationId);
          assert.ok(
            "promptId" in receipt &&
              "promptId" in operation &&
              receipt.promptId === operation.promptId
          );
        } else {
          assert.equal(receipt.error.operationId, operation.operationId);
          assert.ok(receipt.error.retryable, JSON.stringify(receipt.error));
          retry.push(operation);
          delay = Math.max(delay, receipt.error.retryAfter ?? 1);
        }
      }
      pending = retry;
    }
    if (delay) {
      assert.ok(
        performance.now() - started + delay * 1000 <= 120_000,
        "Catch-up retry exceeds deadline"
      );
      throttled += 1;
      await Bun.sleep(delay * 1000);
    }
  }
  return throttled;
};

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
    // Match the default 200-operation/10-second burst budget without disabling it.
    await Bun.sleep(
      Math.max(0, started + (offset / 100) * 5000 - performance.now())
    );
    throttled += await deliverCapacityBatch(
      instance,
      cookie,
      identity,
      operations.slice(offset, offset + 100),
      started
    );
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
    minimumBatchIntervalMs: 5000,
    classification:
      "REST delivery of queued creates; does not measure the native durable outbox or shaped online network",
  };
};
