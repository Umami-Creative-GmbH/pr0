import { expect, test } from "bun:test";

import {
  mutationEnvelopeSchema,
  receiptLookupResponseSchema,
} from "@pr0/api-contract/prompts";

import fixtures from "../../api-contract/src/upload-fixtures.json";
import { createApiClient } from "./client";

const envelope = mutationEnvelopeSchema.parse({
  protocolVersion: 1,
  instanceId: crypto.randomUUID(),
  accountId: crypto.randomUUID(),
  epoch: crypto.randomUUID(),
  installationId: crypto.randomUUID(),
  operations: [fixtures.operation],
});
test("receipt lookup validates shared outcomes, payload matching and cancellation", async () => {
  await Promise.all(
    [fixtures.accepted, fixtures.unknown, fixtures.rejected].map(
      async (outcome) => {
        const client = createApiClient({
          fetcher: () => Promise.resolve(Response.json(outcome)),
        });
        expect(await client.lookupReceipts(envelope)).toEqual(
          receiptLookupResponseSchema.parse(outcome)
        );
      }
    )
  );
  const mismatched = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json({
          results: [{ status: "unknown", operationId: crypto.randomUUID() }],
        })
      ),
  });
  await expect(mismatched.lookupReceipts(envelope)).rejects.toThrow();
  const invalid = createApiClient({
    fetcher: () => Promise.resolve(Response.json({ results: [] })),
  });
  await expect(invalid.lookupReceipts(envelope)).rejects.toThrow();
  const failure = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json(
          {
            code: "authentication_required",
            message: "Sign in",
            retryable: true,
          },
          { status: 401 }
        )
      ),
  });
  await expect(failure.lookupReceipts(envelope)).rejects.toMatchObject({
    status: 401,
  });
  const controller = new AbortController();
  controller.abort();
  const aborted = createApiClient({
    fetcher: (_url, init) => {
      init.signal?.throwIfAborted();
      return Promise.resolve(Response.json(fixtures.accepted));
    },
  });
  await expect(
    aborted.lookupReceipts(envelope, controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
});
