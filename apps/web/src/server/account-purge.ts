// oxlint-disable react-doctor/server-sequential-independent-await -- One transaction removes an account's live data in a fixed lock order.
import "server-only";
import { rmSync } from "node:fs";
import path from "node:path";

import type { TransactionSQL } from "bun";

import { deletionLogLine } from "../lib/deletion-log-files";
import type { DeletionLogEvent } from "../lib/deletion-log-files";
import { AccountFailureError } from "./admission";
import { appendDeletionLog } from "./deletion-log";
import { purgeAccountMail } from "./mail";
import { searchDirectory, searchFilename } from "./search-location";

const searchSuffixes = [
  "",
  "-journal",
  "-wal",
  "-shm",
  ".building",
  ".building-journal",
  ".building-wal",
  ".building-shm",
];

export interface AccountDeletion {
  accountId: string;
  deletedAt: string;
  /** False when no live account remained, for example on a repeated re-delete. */
  purged: boolean;
}

const removeSearchFiles = (instanceId: string, accountId: string) => {
  const root = searchDirectory();
  for (const suffix of searchSuffixes) {
    const target = path.resolve(
      // oxlint-disable-next-line eslint/no-inline-comments -- Turbopack requires its directive inside the filesystem call.
      /* turbopackIgnore: true */ `${searchFilename(instanceId, accountId)}${suffix}`
    );
    if (path.dirname(target) !== root) {
      throw new Error("Invalid deletion path");
    }
    rmSync(target, { force: true });
  }
};

/**
 * Removes one account's live data inside `tx` and leaves only its tombstone.
 * Idempotent: an absent account keeps (or gains) a tombstone and nothing else.
 * `deletedAt` is the original deletion time when an operator re-applies a
 * deletion from the deletion log after a restore.
 */
export const purgeAccount = async (
  tx: TransactionSQL,
  accountId: string,
  deletedAt?: string
): Promise<AccountDeletion> => {
  const [owner] =
    await tx`SELECT u.email,l.deletion_handle FROM "user" u LEFT JOIN library l ON l.account_id=u.id
    WHERE u.id=${accountId} FOR UPDATE OF u`;
  // Search workers take the same lock before opening the account's index files.
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${accountId},56))`;
  if (owner) {
    await purgeAccountMail(tx, accountId, owner.email);
    await tx`DELETE FROM verification WHERE value=${accountId}
      OR CASE WHEN pg_input_is_valid(value,'jsonb') THEN
      jsonb_path_exists(value::jsonb,'$.** ? (@ == $accountId || @ == $email)',
        jsonb_build_object('accountId',${accountId}::text,'email',${owner.email}::text)) ELSE false END`;
    await tx`DELETE FROM social_pending WHERE email=${owner.email} OR (provider,subject) IN
      (SELECT provider_id,account_id FROM account WHERE user_id=${accountId})`;
    await tx`DELETE FROM registration_admission WHERE email=${owner.email}`;
    await tx`DELETE FROM admission_bucket WHERE position(${accountId} in key)>0 OR position(${owner.email} in key)>0`;
    await tx`DELETE FROM request_work WHERE owner=${accountId}`;
    // Sessions, tokens, devices, library, prompts and history cascade from the user.
    await tx`DELETE FROM "user" WHERE id=${accountId}`;
  }
  const [tombstone] =
    await tx`INSERT INTO deleted_accounts(account_id,handle,deleted_at)
    VALUES (${accountId},${owner?.deletion_handle ?? null},COALESCE(${deletedAt ?? null}::timestamptz,clock_timestamp()))
    ON CONFLICT(account_id) DO UPDATE SET handle=COALESCE(deleted_accounts.handle,EXCLUDED.handle)
    RETURNING deleted_at`;
  const [instance] = await tx`SELECT id FROM instance`;
  // Removed before commit: if the commit fails, the files are derived and rebuilt.
  removeSearchFiles(String(instance.id), accountId);
  return {
    accountId,
    deletedAt: new Date(tombstone.deleted_at).toISOString(),
    purged: Boolean(owner),
  };
};

/**
 * Records a deletion in the durable deletion log inside its transaction, before
 * commit. A failed append throws, so the deletion rolls back and is retried.
 */
export const recordAccountDeletion = (deletion: AccountDeletion) => {
  try {
    appendDeletionLog(
      deletionLogLine(
        "account_deleted",
        deletion.accountId,
        deletion.deletedAt
      ),
      deletion.deletedAt
    );
  } catch {
    throw new AccountFailureError("unavailable", 503, 5);
  }
};

/** The deletion log on stdout: opaque account ID and time only, never an email. */
export const logAccountDeletion = (
  deletion: AccountDeletion,
  event: DeletionLogEvent = "account_deleted"
) => {
  process.stdout.write(
    `${deletionLogLine(event, deletion.accountId, deletion.deletedAt)}\n`
  );
};
