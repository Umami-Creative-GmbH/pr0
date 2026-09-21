import assert from "node:assert/strict";
import { mkdirSync, rmdirSync } from "node:fs";
import path from "node:path";

import { deletionTrustSchema } from "@pr0/api-contract/deletions";

import { runAcceptance } from "./account-test-server";
import type { accountTestServer } from "./account-test-server";
import {
  backupCommand,
  backupCompose,
  refusedRestore,
  resetRehearsalDatabase,
  restoreCommand,
  ledgerSnapshot,
  restoreLedgerFixture,
} from "./backup-restore-fixture";
import { freshSocialBrowser } from "./email-change-fixture";
import { origin, post } from "./http-fixture";

export const verifyPendingRestore = async (
  server: ReturnType<typeof accountTestServer>
) => {
  const account = await freshSocialBrowser();
  const response = await fetch(`${origin}/api/v1/account/deletion`, {
    headers: { Cookie: account.Cookie },
  });
  const trust = deletionTrustSchema.parse(await response.json());
  const ledger = await ledgerSnapshot("ledger-a");
  await runAcceptance([...backupCompose, "stop", "ledger-a"]);
  const deletion = await post(
    "/api/v1/account/deletion",
    { ...account.identity, confirmation: "delete-account" },
    { Cookie: account.Cookie }
  );
  assert.equal(deletion.status, 202);
  await server.stopServer();
  await server.stopMail();
  await restoreCommand("close");
  const snapshot = await backupCommand("create");
  await runAcceptance([...backupCompose, "up", "-d", "--wait", "ledger-a"]);
  await restoreLedgerFixture("ledger-a", ledger);
  await restoreCommand("seal");
  await resetRehearsalDatabase();
  await backupCommand("restore", snapshot.archive);
  process.env.BETTER_AUTH_SECRET = `pending-recovery-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const obstacle = path.join(
    process.env.PR0_SEARCH_DIRECTORY ?? "",
    `${trust.instanceId}-${trust.accountId}.sqlite`
  );
  mkdirSync(obstacle, { recursive: true });
  await refusedRestore("prepare", /EISDIR|directory/iu);
  rmdirSync(obstacle);
  // First attempt appended a previously unrecorded intent; retry must preserve the sealed history.
  await restoreCommand("prepare");
  server.startMail();
  await server.startServer({}, false);
  await backupCommand("create");
  await restoreCommand("open");
  const lookup = await fetch(
    `${origin}/api/v1/account-deletions/${trust.handle}`
  );
  const result = await lookup.json();
  assert.equal(result.status, "deleted");
  const evidence = {
    measuredAt: new Date().toISOString(),
    restoredPendingIntentCompleted: true,
    retryAfterNewIntentAppend: true,
  };
  await Bun.write(
    "docs/evidence/issue-61-pending-rehearsal.json",
    `${JSON.stringify(evidence, null, 2)}\n`
  );
};
