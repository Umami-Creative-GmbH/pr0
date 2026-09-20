// oxlint-disable promise/no-return-wrap -- Injected fetch functions return Promise<Response>; these are not promise continuation return values.
import { expect, test } from "bun:test";

import { snapshotManifestSchema } from "@pr0/api-contract/snapshots";

import fixture from "../../api-contract/src/snapshot-fixtures.json";
import { createSnapshotClient } from "./snapshots";

test("snapshot download refuses a manifest belonging to another account", async () => {
  const client = createSnapshotClient(
    "https://example.test",
    {
      instanceId: "11111111-1111-4111-8111-111111111111",
      accountId: "22222222-2222-4222-8222-222222222222",
    },
    () => Promise.resolve(Response.json(fixture.manifest))
  );
  await expect(client.create()).rejects.toThrow("snapshot_identity_mismatch");
});

test("shared native fixtures preserve exact content and reject a corrupt page", async () => {
  const manifest = snapshotManifestSchema.parse(fixture.manifest);
  const client = createSnapshotClient("https://example.test", manifest, () =>
    Promise.resolve(Response.json(fixture.pages[0]))
  );
  const records = await client.page(manifest, 0);
  expect(records.prompts[0]?.content).toBe("  Hello offline\n");
  const corrupt = createSnapshotClient("https://example.test", manifest, () =>
    Promise.resolve(Response.json({ ...fixture.pages[0], payload: "changed" }))
  );
  await expect(corrupt.page(manifest, 0)).rejects.toThrow(
    "snapshot_digest_mismatch"
  );
});

test("snapshot cancellation cancels a response stream without acknowledging data", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const client = createSnapshotClient(
    "https://example.test",
    fixture.manifest,
    () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode("{"));
              setTimeout(() => controller.abort(), 10);
            },
            cancel() {
              cancelled = true;
            },
          })
        )
      )
  );
  await expect(client.create(controller.signal)).rejects.toThrow();
  expect(cancelled).toBe(true);
});

test("snapshot HTTP failures and malformed or oversized responses are rejected and streams closed", async () => {
  await Promise.all(
    [401, 403, 410, 429, 503].map(async (status) => {
      let cancelled = false;
      const client = createSnapshotClient(
        "https://example.test",
        fixture.manifest,
        () =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                cancel() {
                  cancelled = true;
                },
              }),
              { status }
            )
          )
      );
      await expect(client.create()).rejects.toThrow(
        status === 410 ? "snapshot_expired" : "snapshot_unavailable"
      );
      expect(cancelled).toBe(true);
    })
  );
  await Promise.all(
    [
      Response.json({}),
      new Response("invalid-json"),
      new Response(new Uint8Array([0xff])),
    ].map(async (response) => {
      const client = createSnapshotClient(
        "https://example.test",
        fixture.manifest,
        () => Promise.resolve(response)
      );
      await expect(client.create()).rejects.toThrow();
    })
  );
  let cancelled = false;
  const client = createSnapshotClient(
    "https://example.test",
    fixture.manifest,
    () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new Uint8Array(262_145));
            },
            cancel() {
              cancelled = true;
            },
          })
        )
      )
  );
  await expect(client.create()).rejects.toThrow("invalid_response");
  expect(cancelled).toBe(true);
});

test("snapshot client rejects missing or mismatched first-page organization even with a valid digest", async () => {
  await Promise.all(
    fixture.malformed.map(async (entry) => {
      const manifest = snapshotManifestSchema.parse(entry.manifest);
      const client = createSnapshotClient(
        "https://example.test",
        manifest,
        () => Promise.resolve(Response.json(entry.page))
      );
      await expect(client.page(manifest, entry.page.page)).rejects.toThrow(
        "invalid_response"
      );
    })
  );
});
