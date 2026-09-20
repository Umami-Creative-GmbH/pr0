import assert from "node:assert/strict";
import path from "node:path";

import { snapshotManifestSchema } from "@pr0/api-contract/snapshots";

import type { accountTestServer } from "./account-test-server";
import {
  approveDevice,
  redeem,
  startDevice,
  tokenFrom,
  verifiedBrowser,
} from "./device-fixture";
import { post } from "./http-fixture";

export const verifySnapshotExpiry = async (
  server: ReturnType<typeof accountTestServer>
) => {
  const owner = await verifiedBrowser();
  const code = await startDevice();
  await approveDevice(code.user_code, owner.library.account.id, owner.browser);
  const token = await tokenFrom(await redeem(code.device_code));
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const initial = await post("/api/v1/sync/snapshots", {}, headers);
  const manifest = snapshotManifestSchema.parse(await initial.json());
  await server.startServer({ PR0_TEST_TIME_OFFSET_MS: "960000" }, true, [
    path.join(import.meta.dir, "device-clock-preload.ts"),
  ]);
  try {
    const expired = await post(
      "/api/v1/sync/snapshots/page",
      { id: manifest.id, page: 0 },
      headers
    );
    assert.equal(expired.status, 410);
    const renewed = await post("/api/v1/sync/snapshots", {}, headers);
    const fresh = snapshotManifestSchema.parse(await renewed.json());
    assert.notEqual(fresh.id, manifest.id);
    const page = await post(
      "/api/v1/sync/snapshots/page",
      { id: fresh.id, page: 0 },
      headers
    );
    assert.equal(page.status, 200);
    process.stdout.write(
      "PASS expired snapshot returns 410 across server restart; fresh manifest downloads successfully\n"
    );
  } finally {
    await server.startServer();
  }
};
