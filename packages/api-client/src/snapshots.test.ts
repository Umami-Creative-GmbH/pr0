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
