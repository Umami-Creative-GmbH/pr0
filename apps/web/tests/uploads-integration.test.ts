import { expect, test } from "bun:test";

import { createPromptClient } from "@pr0/api-client/prompts";
import { mutationResponseSchema } from "@pr0/api-contract/prompts";
import { snapshotManifestSchema } from "@pr0/api-contract/snapshots";

import {
  approveDevice,
  redeem,
  startDevice,
  tokenFrom,
  verifiedBrowser,
} from "./device-fixture";
import { origin, post } from "./http-fixture";
import { seedCapacity } from "./prompt-capacity-fixture";
import { promptOperation, promptEdit, promptClient } from "./prompt-fixture";

test("a device uploads once and resolves a lost acknowledgement without restoring later deleted text", async () => {
  const account = await verifiedBrowser();
  const code = await startDevice();
  await approveDevice(
    code.user_code,
    account.library.account.id,
    account.browser
  );
  const token = await tokenFrom(await redeem(code.device_code));
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const snapshot = await post("/api/v1/sync/snapshots", {}, headers);
  const manifest = await snapshot.json();
  const operation = promptOperation();
  const envelope = {
    protocolVersion: 1,
    instanceId: manifest.instanceId,
    accountId: manifest.accountId,
    epoch: manifest.epoch,
    installationId: crypto.randomUUID(),
    operations: [operation],
  };
  const accepted = await post("/api/v1/sync/mutations", envelope, headers);
  expect(accepted.status).toBe(200);
  const receipt = await accepted.json();
  expect(receipt.results[0]).toMatchObject({
    status: "accepted",
    operationId: operation.operationId,
  });
  const lookup = await post("/api/v1/sync/receipts", envelope, headers);
  expect(lookup.status).toBe(200);
  expect(await lookup.json()).toEqual(receipt);
  const client = createPromptClient(origin, (url, init) =>
    fetch(url, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        Cookie: account.browser,
        Origin: origin,
      },
    })
  );
  const prompt = await client.getPrompt(operation.promptId);
  expect(prompt.content).toBe(operation.desired.content);
  const cached = await post(
    "/api/v1/sync/snapshots",
    { minimumRevision: receipt.results[0].revision },
    headers
  );
  const cachedManifest = snapshotManifestSchema.parse(await cached.json());
  const deleted = await client.mutatePrompts({
    ...envelope,
    protocolVersion: 1,
    operations: [
      {
        kind: "prompt.delete",
        operationId: crypto.randomUUID(),
        promptId: operation.promptId,
        baseRevision: receipt.results[0].revision,
        dependsOn: [],
      },
    ],
  });
  expect(deleted.results[0]?.status).toBe("accepted");
  const oldLookup = await post("/api/v1/sync/receipts", envelope, headers);
  expect(await oldLookup.json()).toEqual(receipt);
  const replay = await post("/api/v1/sync/mutations", envelope, headers);
  expect(await replay.json()).toEqual(receipt);
  const reconciliation = await post(
    "/api/v1/sync/snapshots",
    { minimumRevision: receipt.results[0].revision },
    headers
  );
  const reconciliationManifest = snapshotManifestSchema.parse(
    await reconciliation.json()
  );
  expect(reconciliationManifest.promptCount).toBe(0);
  expect(reconciliationManifest.id).not.toBe(cachedManifest.id);
  const page = await client.getPrompts();
  expect(page.usage.promptCount).toBe(0);
  const changed = {
    ...envelope,
    operations: [
      {
        ...operation,
        desired: { ...operation.desired, content: "Different payload" },
      },
    ],
  };
  const reused = await post("/api/v1/sync/receipts", changed, headers);
  expect(await reused.json()).toMatchObject({
    results: [
      { status: "rejected", error: { code: "operation_identity_reused" } },
    ],
  });
});

test("concurrent device creates serialize quotas and mixed receipts preserve blocked dependencies", async () => {
  const account = await verifiedBrowser();
  const code = await startDevice();
  await approveDevice(
    code.user_code,
    account.library.account.id,
    account.browser
  );
  const token = await tokenFrom(await redeem(code.device_code));
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const snapshot = await post("/api/v1/sync/snapshots", {}, headers);
  const manifest = snapshotManifestSchema.parse(await snapshot.json());
  const identity = {
    protocolVersion: 1 as const,
    instanceId: manifest.instanceId,
    accountId: manifest.accountId,
    epoch: manifest.epoch,
    installationId: crypto.randomUUID(),
  };
  await seedCapacity(identity, "promptCount");
  const operations = [promptOperation(), promptOperation()];
  const replies = await Promise.all(
    operations.map(async (operation) => {
      const response = await post(
        "/api/v1/sync/mutations",
        { ...identity, operations: [operation] },
        headers
      );
      return mutationResponseSchema.parse(await response.json());
    })
  );
  const results = replies.flatMap((reply) => reply.results);
  expect(results.filter((entry) => entry.status === "accepted")).toHaveLength(
    1
  );
  expect(results.filter((entry) => entry.status === "rejected")).toHaveLength(
    1
  );
  const accepted = results.find(
    (entry) => entry.status === "accepted" && "promptId" in entry
  );
  if (
    !accepted ||
    accepted.status !== "accepted" ||
    !("promptId" in accepted)
  ) {
    throw new Error("Expected one accepted prompt");
  }
  const client = promptClient(account.browser);
  const saved = await client.getPrompt(accepted.promptId);
  const refused = promptOperation();
  const dependent = { ...promptOperation(), dependsOn: [refused.operationId] };
  const mixed = await post(
    "/api/v1/sync/mutations",
    {
      ...identity,
      operations: [
        refused,
        dependent,
        promptEdit(saved, { title: "x", description: "", content: "y" }),
      ],
    },
    headers
  );
  expect(await mixed.json()).toMatchObject({
    results: [
      { status: "rejected", error: { code: "quota_exceeded" } },
      { status: "rejected", error: { code: "dependency_blocked" } },
      { status: "accepted" },
    ],
  });
  const forbidden = await post(
    "/api/v1/sync/mutations",
    { ...identity, operations: [refused] },
    { ...headers, Cookie: account.browser }
  );
  expect(forbidden.status).toBe(403);
  const other = await post(
    "/api/v1/sync/mutations",
    { ...identity, accountId: crypto.randomUUID(), operations: [refused] },
    headers
  );
  expect(await other.json()).toMatchObject({
    results: [{ status: "rejected", error: { code: "forbidden" } }],
  });
  const newer = await post(
    "/api/v1/sync/snapshots",
    { minimumRevision: accepted.revision },
    headers
  );
  const fresh = snapshotManifestSchema.parse(await newer.json());
  expect(BigInt(fresh.revision)).toBeGreaterThanOrEqual(
    BigInt(accepted.revision)
  );
  expect(fresh.id).not.toBe(manifest.id);
});
