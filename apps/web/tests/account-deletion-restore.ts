import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  deletionIdentitySchema,
  deletionLookupSchema,
  deletionResultSchema,
} from "@pr0/api-contract/deletions";
import { SQL } from "bun";

import { deletionLogLine } from "../src/lib/deletion-log-files";
import type { accountTestServer } from "./account-test-server";
import { freshSocialBrowser } from "./email-change-fixture";
import { origin, post } from "./http-fixture";

const root = path.resolve(import.meta.dir, "../../..");
const container = "pr0-deletion-56-database-1";
const snapshot = async () => {
  const child = Bun.spawn(
    [
      "docker",
      "exec",
      container,
      "pg_dump",
      "-U",
      "pr0",
      "-d",
      "pr0",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
    ],
    { stdout: "pipe", stderr: "inherit" }
  );
  const dump = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) {
    throw new Error("Disposable restore snapshot failed");
  }
  return dump;
};
const restore = async (dump: string) => {
  const child = Bun.spawn(
    [
      "docker",
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "pr0",
      "-d",
      "pr0",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { stdin: new Blob([dump]), stdout: "ignore", stderr: "inherit" }
  );
  if ((await child.exited) !== 0) {
    throw new Error("Disposable database restore failed");
  }
};
/** Re-applies the given log files or directories, or `stdin` when none are given. */
const reapply = async (inputs: string[], stdin = "") => {
  const child = Bun.spawn(
    [
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/deletions.ts",
      "reapply",
      ...inputs,
    ],
    { cwd: root, stdin: new Blob([stdin]), stdout: "pipe", stderr: "inherit" }
  );
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) {
    throw new Error("Re-deletion failed");
  }
  return output;
};

/**
 * The accepted risk of ADR-0005 and its manual mitigation: restoring a
 * database copy taken before a deletion brings the account back, and
 * re-applying the deletion log removes it again.
 */
export const deletionRestoreScenario = async (
  server: ReturnType<typeof accountTestServer>
) => {
  const account = await freshSocialBrowser();
  const setup = await fetch(`${origin}/api/v1/account/deletion`, {
    headers: { Cookie: account.Cookie },
  });
  const identity = deletionIdentitySchema.parse(await setup.json());
  const older = await snapshot();
  const deletion = await post(
    "/api/v1/account/deletion",
    { ...account.identity, confirmation: "delete-account" },
    { Cookie: account.Cookie }
  );
  assert.equal(deletion.status, 200);
  const result = deletionResultSchema.parse(await deletion.json());
  // The durable deletion log holds this deletion's line and never an email.
  const directory = process.env.PR0_DELETION_LOG_DIRECTORY ?? "";
  const logLine = deletionLogLine(
    "account_deleted",
    result.accountId,
    result.deletedAt
  );
  const recorded = readdirSync(directory)
    .map((name) => readFileSync(path.join(directory, name), "utf-8"))
    .join("");
  assert.ok(recorded.split("\n").includes(logLine));
  assert.ok(!recorded.includes(account.email), "no email in the log file");
  await server.stopServer();
  await server.stopMail();
  // These are exclusively the disposable containers owned by this runner.
  await restore(older);
  const app = new SQL(process.env.DATABASE_URL ?? "");
  try {
    const [restored] =
      await app`SELECT count(*)::int AS count FROM "user" WHERE id=${identity.accountId}`;
    assert.equal(restored.count, 1, "an older copy brings the account back");
    // Runbook step: re-apply the whole log directory (earlier deletions too).
    const output = await reapply([directory]);
    assert.match(output, /"event":"account_redeleted"/u);
    assert.match(output, /"purged":1\}/u);
    // Idempotent, and stdin works too: a second pass finds nothing to purge.
    assert.match(
      await reapply([], `unrelated line\n${logLine}\n`),
      /"read":1,"purged":0/u
    );
    const [gone] =
      await app`SELECT count(*)::int AS count FROM "user" WHERE id=${identity.accountId}`;
    assert.equal(gone.count, 0);
    const [tombstone] =
      await app`SELECT handle,deleted_at FROM deleted_accounts WHERE account_id=${identity.accountId}`;
    assert.equal(tombstone.handle, identity.handle);
    assert.equal(
      new Date(tombstone.deleted_at).toISOString(),
      result.deletedAt
    );
  } finally {
    await app.close();
  }
  await server.startServer();
  server.startMail();
  const lookup = await fetch(
    `${origin}/api/v1/account-deletions/${identity.handle}`
  );
  const status = deletionLookupSchema.parse(await lookup.json());
  assert.deepEqual(status, result);
  const library = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: account.Cookie },
  });
  assert.equal(library.status, 401);
};
