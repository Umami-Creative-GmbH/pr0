import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmdirSync } from "node:fs";
import path from "node:path";

import {
  deletionIdentitySchema,
  deletionResultSchema,
} from "@pr0/api-contract/deletions";
import { SQL } from "bun";

import {
  deletionLogFilename,
  deletionLogLine,
} from "../src/lib/deletion-log-files";
import { accountTestServer, runAcceptance } from "./account-test-server";
import {
  assertHttpStatus,
  backupCommand,
  backupCompose,
  reapply,
  refusedReapply,
  refusedRestore,
  resetRehearsalDatabase,
  restoreCommand,
} from "./backup-restore-fixture";
import { rehearseNativeRestore } from "./backup-restore-native";
import { verifyBackupStorage } from "./backup-storage-journey";
import { freshSocialBrowser } from "./email-change-fixture";
import { origin, post, cookieFrom, accountEmailLink } from "./http-fixture";
import { promptBrowser, promptClient, promptOperation } from "./prompt-fixture";
import { githubLogin, libraryFor } from "./social-fixture";

process.chdir(path.resolve(import.meta.dir, "../../.."));

const directory = path.resolve(
  `apps/web/.data/rehearsal-61-${crypto.randomUUID()}`
);
process.env.PR0_REHEARSAL_DIRECTORY = directory;
process.env.PR0_RECOVERY_STATE_FILE = path.join(directory, "recovery.json");
process.env.PR0_SEARCH_DIRECTORY = path.join(directory, "search");
// The durable deletion log, a directory beside (never inside) the backups.
const deletionLogDirectory = path.join(directory, "deletion-log");
mkdirSync(deletionLogDirectory, { recursive: true });
process.env.PR0_DELETION_LOG_DIRECTORY = deletionLogDirectory;
const server = accountTestServer(
  "pr0-restore-61",
  "apps/web/tests/backup-restore-compose.yaml",
  async () => {
    await runAcceptance([
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/restore.ts",
      "initialize",
    ]);
  }
);
try {
  await server.setup();
  const survivor = await promptBrowser();
  const client = promptClient(survivor.Cookie);
  const saved = promptOperation({
    title: "Survives recovery",
    description: "",
    content: "Exact retained text",
  });
  await client.mutatePrompts({ ...survivor.identity, operations: [saved] });
  const deleted = await freshSocialBrowser();
  const trustResponse = await fetch(`${origin}/api/v1/account/deletion`, {
    headers: { Cookie: deleted.Cookie },
  });
  const trust = deletionIdentitySchema.parse(await trustResponse.json());
  await post("/api/auth/request-password-reset", { email: survivor.email });
  const resetLink = await accountEmailLink(
    survivor.email,
    "Reset your pr0 password"
  );
  const resetToken = new URLSearchParams(new URL(resetLink).hash.slice(1)).get(
    "token"
  );
  const ordinary = await backupCommand("create");
  const deletion = await post(
    "/api/v1/account/deletion",
    { ...deleted.identity, confirmation: "delete-account" },
    { Cookie: deleted.Cookie }
  );
  assert.equal(deletion.status, 200);
  const deletedResult = deletionResultSchema.parse(await deletion.json());
  // The durable deletion log file and stdout carry the same line: account ID
  // and time only.
  const line = deletionLogLine(
    "account_deleted",
    deletedResult.accountId,
    deletedResult.deletedAt
  );
  const deletionLog = readFileSync(
    path.join(
      deletionLogDirectory,
      deletionLogFilename(deletedResult.deletedAt)
    ),
    "utf-8"
  );
  assert.ok(
    deletionLog.split("\n").includes(line),
    "the deletion is in the file"
  );
  assert.ok(server.serverLog().includes(line), "and on stdout");
  assert.ok(!deletionLog.includes(deleted.email), "no email in the log file");
  const lossSeconds = (Date.now() - Date.parse(ordinary.checkpoint)) / 1000;
  const recoveryStarted = Date.now();
  await restoreCommand("close");
  await assertHttpStatus("/api/v1/capabilities", 503);
  await assertHttpStatus("/api/v1/ready", 503);
  await server.stopServer();
  await server.stopMail();
  await resetRehearsalDatabase();
  await backupCommand("restore", ordinary.archive);
  process.env.BETTER_AUTH_SECRET =
    "rotated-restore-test-auth-secret-at-least-32-characters";
  // Accepted risk (ADR-0005): the older archive brings the deleted account back.
  const app = new SQL(process.env.DATABASE_URL ?? "");
  const owners = async () => {
    const [row] =
      await app`SELECT count(*)::int AS count FROM "user" WHERE id=${trust.accountId}`;
    return Number(row.count);
  };
  try {
    assert.equal(await owners(), 1);
    await server.startServer({}, false);
    await assertHttpStatus("/api/v1/library", 503, survivor.Cookie);
    await server.stopServer();
    // Runbook step: re-delete from the deletion log before reopening.
    const purgeObstacle = path.join(
      process.env.PR0_SEARCH_DIRECTORY,
      `${trust.instanceId}-${trust.accountId}.sqlite`
    );
    mkdirSync(purgeObstacle, { recursive: true });
    await refusedReapply(deletionLogDirectory, /EISDIR|directory/iu);
    assert.equal(await owners(), 1, "a failed re-delete rolls back");
    rmdirSync(purgeObstacle);
    assert.match(await reapply(deletionLogDirectory), /"read":1,"purged":1/u);
    assert.equal(await owners(), 0);
  } finally {
    await app.close();
  }
  await restoreCommand("prepare");
  // A process interruption after preparation still leaves public requests closed.
  server.startMail();
  await server.startServer({}, false);
  await assertHttpStatus("/api/v1/library", 503, survivor.Cookie);
  await refusedRestore("open", /fresh encrypted backup/u);
  await backupCommand("create");
  await restoreCommand("open");
  await assertHttpStatus("/api/v1/ready", 200);
  await assertHttpStatus("/api/v1/library", 401, survivor.Cookie);
  await assertHttpStatus("/api/v1/library", 401, deleted.Cookie);
  const obsoleteReset = await post("/api/auth/reset-password", {
    token: resetToken,
    newPassword: "restored-token-must-not-work",
  });
  assert.equal(obsoleteReset.status, 400);
  const lookup = await fetch(
    `${origin}/api/v1/account-deletions/${trust.handle}`
  );
  const result = await lookup.json();
  assert.equal(result.status, "deleted");
  const recoveredCookie = cookieFrom(
    await githubLogin(survivor.subject, survivor.email)
  );
  const recovered = await libraryFor(recoveredCookie);
  assert.notEqual(recovered.epoch, survivor.identity.epoch);
  assert.equal(recovered.account.id, survivor.identity.accountId);
  const recoveredPrompt = await promptClient(recoveredCookie).getPrompt(
    saved.promptId
  );
  assert.equal(recoveredPrompt.content, "Exact retained text");
  const recoverySeconds = (Date.now() - recoveryStarted) / 1000;
  assert.ok(lossSeconds <= 3600);
  assert.ok(recoverySeconds <= 86_400);
  const evidence = {
    measuredAt: new Date().toISOString(),
    ordinaryLossWindowSeconds: lossSeconds,
    recoverySeconds,
    acknowledgedDeletionsLost: 0,
    encryptedRoundTrip: true,
    restoredArchiveBroughtDeletedAccountBack: true,
    deletionReappliedFromLog: true,
    failedReapplyRolledBack: true,
    interruptedRestoreStayedClosed: true,
    restoredSessionAndActionTokenRefused: true,
  };
  await Bun.write(
    "docs/evidence/issue-61-rehearsal.json",
    `${JSON.stringify(evidence, null, 2)}\n`
  );
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  await verifyBackupStorage();
  if (process.env.PR0_RESTORE_NATIVE === "1") {
    await rehearseNativeRestore(server);
  }
} finally {
  await server.cleanup();
  await runAcceptance([
    ...backupCompose,
    "--profile",
    "operations",
    "down",
    "--volumes",
  ]);
}
