import assert from "node:assert/strict";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  deletionIdentitySchema,
  deletionLookupSchema,
  deletionResultSchema,
} from "@pr0/api-contract/deletions";
import { SQL } from "bun";

import {
  deletionLogFilename,
  deletionLogLine,
} from "../src/lib/deletion-log-files";
import { freshSocialBrowser } from "./email-change-fixture";
import { origin, post } from "./http-fixture";

const json = async (route: string, Cookie?: string) => {
  const response = await fetch(`${origin}${route}`, {
    headers: Cookie ? { Cookie } : {},
  });
  return response.json();
};
const identityOf = async (Cookie: string) =>
  deletionIdentitySchema.parse(await json("/api/v1/account/deletion", Cookie));
const lookup = async (handle: string) =>
  deletionLookupSchema.parse(await json(`/api/v1/account-deletions/${handle}`));
const libraryStatus = async (Cookie: string) => {
  const response = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie },
  });
  return response.status;
};
/**
 * Deletion is one transaction: a failure at its last write (the tombstone)
 * leaves the account fully usable, and a retry deletes everything. A tombstone
 * carried over from a pending ledger deletion (migration 21) is purged by the
 * next server process before it admits account work.
 */
export const deletionRestartScenarios = async (server: {
  stopServer: () => Promise<void>;
  startServer: () => Promise<void>;
}) => {
  const app = new SQL(process.env.DATABASE_URL ?? "");
  try {
    const account = await freshSocialBrowser();
    const identity = await identityOf(account.Cookie);
    await app.unsafe(`CREATE FUNCTION fixture_deletion_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'controlled deletion failure'; END; $$;
      CREATE TRIGGER fixture_deletion_failure BEFORE INSERT ON deleted_accounts
      FOR EACH ROW EXECUTE FUNCTION fixture_deletion_failure();`);
    let failed: Response;
    try {
      failed = await post(
        "/api/v1/account/deletion",
        { ...account.identity, confirmation: "delete-account" },
        { Cookie: account.Cookie }
      );
    } finally {
      await app.unsafe(
        "DROP TRIGGER IF EXISTS fixture_deletion_failure ON deleted_accounts; DROP FUNCTION IF EXISTS fixture_deletion_failure();"
      );
    }
    assert.ok(failed.status >= 500, `rolled back with ${failed.status}`);
    const before = await lookup(identity.handle);
    assert.equal(before.status, "absent");
    assert.equal(await libraryStatus(account.Cookie), 200);
    const [kept] =
      await app`SELECT count(*)::int AS count FROM session WHERE user_id=${identity.accountId}`;
    assert.ok(kept.count > 0, "sessions survive a rolled-back deletion");

    // A deletion whose log line can't be appended rolls back and is retryable:
    // put a plain file where the deletion log directory should be.
    const directory = process.env.PR0_DELETION_LOG_DIRECTORY ?? "";
    const moved = `${directory}.moved`;
    renameSync(directory, moved);
    writeFileSync(directory, "not a directory");
    let unrecorded: Response;
    try {
      unrecorded = await post(
        "/api/v1/account/deletion",
        { ...account.identity, confirmation: "delete-account" },
        { Cookie: account.Cookie }
      );
    } finally {
      rmSync(directory, { force: true });
      renameSync(moved, directory);
    }
    assert.equal(unrecorded.status, 503);
    assert.ok(unrecorded.headers.get("retry-after"), "retryable");
    const notRecorded = await lookup(identity.handle);
    assert.equal(notRecorded.status, "absent");
    assert.equal(await libraryStatus(account.Cookie), 200);

    const retried = await post(
      "/api/v1/account/deletion",
      { ...account.identity, confirmation: "delete-account" },
      { Cookie: account.Cookie }
    );
    assert.equal(retried.status, 200);
    const result = deletionResultSchema.parse(await retried.json());
    assert.equal(result.accountId, identity.accountId);
    assert.deepEqual(await lookup(identity.handle), result);
    assert.equal(await libraryStatus(account.Cookie), 401);
    // Exactly one durable line for this account, in its month's file, no email.
    const recorded = readFileSync(
      path.join(directory, deletionLogFilename(result.deletedAt)),
      "utf-8"
    );
    const lines = recorded
      .split("\n")
      .filter((line) => line.includes(identity.accountId));
    assert.deepEqual(lines, [
      deletionLogLine("account_deleted", result.accountId, result.deletedAt),
    ]);
    assert.ok(!recorded.includes(account.email), "no email in the log file");
    // Simulate a deletion that was still pending when migration 21 ran.
    const carried = await freshSocialBrowser();
    const carriedIdentity = await identityOf(carried.Cookie);
    await server.stopServer();
    await app.begin(async (tx) => {
      await tx`UPDATE "user" SET deletion_pending=true WHERE id=${carriedIdentity.accountId}`;
      await tx`INSERT INTO deleted_accounts(account_id,handle,deleted_at)
        VALUES (${carriedIdentity.accountId},${carriedIdentity.handle},clock_timestamp())`;
    });
    await server.startServer();
    const [left] =
      await app`SELECT count(*)::int AS count FROM "user" WHERE id=${carriedIdentity.accountId}`;
    assert.equal(left.count, 0);
    // The carried-over deletion is recorded in the durable log too.
    assert.ok(
      readFileSync(
        path.join(directory, deletionLogFilename(new Date().toISOString())),
        "utf-8"
      ).includes(carriedIdentity.accountId)
    );
    const carriedStatus = await lookup(carriedIdentity.handle);
    assert.equal(carriedStatus.status, "deleted");
    assert.equal(await libraryStatus(carried.Cookie), 401);
  } finally {
    await app.close();
  }
};
