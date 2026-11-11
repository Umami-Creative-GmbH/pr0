// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Each leftover account is purged in its own transaction.
import "server-only";
import { logAccountDeletion, purgeAccount } from "./account-purge";
import { database } from "./database";
import { assertRestoreAdmission } from "./restore-state";

/**
 * Purges live data still present for a tombstoned account. Deletion is one
 * transaction, so this only finds deletions that were pending when migration
 * 21 replaced the ledger design with tombstones.
 */
export const purgeTombstonedAccounts = async () => {
  const sql = database();
  const leftovers = await sql<{ account_id: string; deleted_at: Date }[]>`
    SELECT d.account_id,d.deleted_at FROM deleted_accounts d JOIN "user" u ON u.id=d.account_id ORDER BY d.account_id`;
  for (const row of leftovers) {
    const deletion = await sql.begin((tx) =>
      purgeAccount(tx, row.account_id, row.deleted_at.toISOString())
    );
    logAccountDeletion(deletion);
  }
  return leftovers.length;
};

let startup: Promise<number> | undefined;
export const ensureDeletionRecovery = async (recoveryCheck = false) => {
  if (!recoveryCheck) {
    assertRestoreAdmission();
  }
  startup ??= purgeTombstonedAccounts();
  try {
    await startup;
  } catch (error) {
    startup = undefined;
    throw error;
  }
};
