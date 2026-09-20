import { expect, test } from "bun:test";

import { createSnapshotClient } from "@pr0/api-client/snapshots";

import {
  approveDevice,
  redeem,
  startDevice,
  tokenFrom,
  verifiedBrowser,
} from "./device-fixture";
import { origin, post } from "./http-fixture";
import { promptOperation } from "./prompt-fixture";

test("a desktop downloads a stable revision cut and cannot read another account's pages", async () => {
  const owner = await verifiedBrowser();
  const operation = promptOperation({
    title: "Offline",
    content: "  Keep my text\n",
    description: "",
  });
  const mutation = await post(
    "/api/v1/sync/mutations",
    {
      protocolVersion: 1,
      instanceId: owner.library.instance.id,
      accountId: owner.library.account.id,
      epoch: owner.library.epoch,
      installationId: crypto.randomUUID(),
      operations: [operation],
    },
    { Cookie: owner.browser }
  );
  expect(mutation.status).toBe(200);
  const code = await startDevice();
  await approveDevice(code.user_code, owner.library.account.id, owner.browser);
  const token = await tokenFrom(await redeem(code.device_code));
  const client = createSnapshotClient(
    origin,
    {
      instanceId: owner.library.instance.id,
      accountId: owner.library.account.id,
    },
    (url, init) =>
      fetch(url, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${token.access_token}`,
        },
      })
  );
  const manifest = await client.create();
  expect(manifest.promptCount).toBe(1);
  expect(manifest.revision).toBe("1");
  const reused = await client.create();
  expect(reused.id).toBe(manifest.id);
  const later = await post(
    "/api/v1/sync/mutations",
    {
      protocolVersion: 1,
      instanceId: owner.library.instance.id,
      accountId: owner.library.account.id,
      epoch: owner.library.epoch,
      installationId: crypto.randomUUID(),
      operations: [
        promptOperation({
          title: "Later",
          description: "",
          content: "After snapshot cut",
        }),
      ],
    },
    { Cookie: owner.browser }
  );
  expect(later.status).toBe(200);
  const records = await client.page(manifest, 0);
  expect(records.prompts).toHaveLength(1);
  expect(records.prompts[0]?.content).toBe("  Keep my text\n");
  expect(records.organization?.collections).toEqual([]);
  const other = await verifiedBrowser();
  const otherCode = await startDevice();
  await approveDevice(
    otherCode.user_code,
    other.library.account.id,
    other.browser
  );
  const otherToken = await tokenFrom(await redeem(otherCode.device_code));
  const denied = await post(
    "/api/v1/sync/snapshots/page",
    { id: manifest.id, page: 0 },
    { Authorization: `Bearer ${otherToken.access_token}` }
  );
  expect(denied.status).toBe(404);
  const malformed = await post(
    "/api/v1/sync/snapshots/page",
    { id: manifest.id, page: -1 },
    { Authorization: `Bearer ${token.access_token}` }
  );
  expect(malformed.status).toBe(400);
  const browserDenied = await post(
    "/api/v1/sync/snapshots",
    {},
    { Cookie: owner.browser }
  );
  expect(browserDenied.status).toBe(403);
});
