// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Recovery phases and single-library search rebuilds must commit in order.
import { existsSync } from "node:fs";

import { promptBrowseInputSchema } from "@pr0/api-contract/prompts";

import { database } from "../src/server/database";
import { purgeTombstonedAccounts } from "../src/server/deletion-recovery";
import type { RestoreState } from "../src/server/restore-state";
import { ensureSchemaCompatibility } from "../src/server/schema-compatibility";
import { searchFilename } from "../src/server/search-location";
import { searchProjection } from "../src/server/search-projection";

/**
 * Confirms that no tombstoned account still has live data or search files.
 * Deletions made after the restored backup are only covered once the operator
 * has re-applied them from the deletion log (`deletions reapply`).
 */
export const auditDeletedData = async (instanceId: string) => {
  const sql = database();
  // Independently discover all canonical ownership columns, including future tables.
  const tables = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
    AND table_name<>'deleted_accounts'
    AND (column_name IN ('account_id','user_id') OR (table_name='user' AND column_name='id'))`;
  const tombstones = await sql<
    { account_id: string }[]
  >`SELECT account_id FROM deleted_accounts ORDER BY account_id`;
  for (const { account_id: accountId } of tombstones) {
    for (const table of tables) {
      const name = table.table_name.replaceAll('"', '""');
      const column = table.column_name.replaceAll('"', '""');
      const rows = await sql.unsafe(
        `SELECT 1 FROM public."${name}" WHERE "${column}"::text=$1 LIMIT 1`,
        [accountId]
      );
      if (rows.length) {
        throw new Error("Deleted account data remains");
      }
    }
    const filename = searchFilename(instanceId, accountId);
    for (const suffix of [
      "",
      "-wal",
      "-shm",
      "-journal",
      ".building",
      ".building-wal",
      ".building-shm",
      ".building-journal",
    ]) {
      if (existsSync(`${filename}${suffix}`)) {
        throw new Error("Deleted search data remains");
      }
    }
  }
  return tombstones.length;
};

export const prepareRestore = async (state: RestoreState) => {
  const sql = database();
  await ensureSchemaCompatibility(sql, true);
  await sql.begin(async (tx) => {
    // A single transaction invalidates every restored authorization and epoch-bound snapshot.
    await tx`DELETE FROM session`;
    await tx`DELETE FROM verification`;
    await tx`DELETE FROM device_code`;
    await tx`DELETE FROM social_pending`;
    await tx`DELETE FROM mail_job`;
    await tx`DELETE FROM mail_reservation`;
    await tx`UPDATE account_notice SET state='failed' WHERE state='pending'`;
    await tx`UPDATE "user" SET authentication_version=authentication_version+1`;
    await tx`UPDATE account SET access_token=NULL,refresh_token=NULL,id_token=NULL,access_token_expires_at=NULL,refresh_token_expires_at=NULL`;
    await tx`DELETE FROM library_snapshot`;
    await tx`DELETE FROM request_work`;
    await tx`DELETE FROM waiting_poll`;
    await tx`DELETE FROM search_work`;
    await tx`DELETE FROM worker_health`;
    await tx`DELETE FROM search_projection_health`;
    await tx`UPDATE instance SET recovery_epoch=${state.epoch} WHERE id=${state.instanceId}`;
  });
  await purgeTombstonedAccounts();
  await auditDeletedData(state.instanceId);
  let after = "";
  while (true) {
    const rows = await sql<{ account_id: string; revision: string }[]>`
      SELECT account_id,revision::text FROM library WHERE account_id>${after} ORDER BY account_id LIMIT 32`;
    if (!rows.length) {
      break;
    }
    for (const row of rows) {
      await searchProjection({
        scope: {
          instance: state.instanceId,
          account: row.account_id,
          epoch: state.epoch,
          revision: row.revision,
        },
        input: promptBrowseInputSchema.parse({}),
        cancellation: new SharedArrayBuffer(4),
      });
      after = row.account_id;
    }
  }
};
