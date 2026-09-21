import assert from "node:assert/strict";

import { operationalMetricsSchema } from "@pr0/api-contract/operations";
import { SQL } from "bun";

import { runAcceptance } from "./account-test-server";
import { backupCommand, backupCompose } from "./backup-restore-fixture";
import { origin } from "./http-fixture";

const control = (script: string) =>
  runAcceptance([
    ...backupCompose,
    "run",
    "--rm",
    "--entrypoint",
    "bun",
    "backup",
    "--eval",
    script,
  ]);
const metrics = async () => {
  const response = await fetch(`${origin}/api/v1/operations/metrics`, {
    headers: { Authorization: `Bearer ${process.env.PR0_METRICS_SECRET}` },
  });
  assert.equal(response.status, 200);
  return operationalMetricsSchema.parse(await response.json());
};
const refused = async (args: string[]) => {
  const child = Bun.spawn([...backupCompose, "run", "--rm", ...args], {
    env: process.env,
    stdout: "ignore",
    stderr: "pipe",
  });
  const message = await new Response(child.stderr).text();
  assert.notEqual(await child.exited, 0);
  assert.match(message, /backup_failed/u);
};

export const verifyBackupStorage = async () => {
  const initial = await metrics();
  assert.equal(initial.backup.status, "ready");
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  try {
    // External scheduler/clock fault fixture; observe the public monitoring boundary.
    await sql`UPDATE backup_observation SET checkpoint=clock_timestamp()-interval '2 hours'`;
  } finally {
    await sql.close();
  }
  const stale = await metrics();
  assert.equal(stale.backup.status, "unavailable");
  assert.ok(stale.alerts.includes("backup_unavailable"));

  const old = `/var/lib/pr0-backups/${Date.now() - 31 * 86_400_000}-${crypto.randomUUID()}`;
  await control(
    `import {mkdirSync,writeFileSync} from "node:fs"; const folder=${JSON.stringify(old)}; mkdirSync(folder); writeFileSync(folder+"/database.enc","expired partial copy"); writeFileSync(folder+"/unexpected","retention fault");`
  );
  await refused(["backup", "retention"]);
  const failed = await metrics();
  assert.equal(failed.backup.retentionOk, false);
  assert.ok(failed.alerts.includes("backup_unavailable"));
  await control(
    `import {unlinkSync} from "node:fs"; unlinkSync(${JSON.stringify(`${old}/unexpected`)});`
  );
  await runAcceptance([...backupCompose, "run", "--rm", "backup", "retention"]);
  await control(
    `import {existsSync} from "node:fs"; if(existsSync(${JSON.stringify(old)})) throw new Error("Expired archive remains");`
  );
  const archive = await backupCommand("create");
  await refused([
    "-e",
    `PR0_BACKUP_KEY=${"a".repeat(64)}`,
    "backup",
    "verify",
    archive.archive,
  ]);
  const payload = `/var/lib/pr0-backups/${archive.archive}/database.enc`;
  await control(
    `const filename=${JSON.stringify(payload)}; const bytes=new Uint8Array(await Bun.file(filename).arrayBuffer()); bytes[bytes.length-1]^=1; await Bun.write(filename,bytes);`
  );
  await refused(["backup", "verify", archive.archive]);
  await backupCommand("create");
  const healthy = await metrics();
  assert.equal(healthy.backup.status, "ready");
  const evidence = {
    measuredAt: new Date().toISOString(),
    staleCheckpointAlert: true,
    cleanupFailureAlert: true,
    expiredArchiveRemoved: true,
    wrongKeyRefused: true,
    corruptCiphertextRefused: true,
    verifiedCheckpointRecovered: true,
  };
  await Bun.write(
    "docs/evidence/issue-61-storage-rehearsal.json",
    `${JSON.stringify(evidence, null, 2)}\n`
  );
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
};
