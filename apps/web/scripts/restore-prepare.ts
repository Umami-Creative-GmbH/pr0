// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Recovery phases and single-library search rebuilds must commit in order.
import { promptBrowseInputSchema } from "@pr0/api-contract/prompts";

import { database } from "../src/server/database";
import {
  completeDeletion,
  pendingClaims,
  resumeDeletions,
} from "../src/server/deletion-coordinator";
import { readEvidence } from "../src/server/deletion-ledger";
import type { RestoreState } from "../src/server/restore-state";
import { ensureSchemaCompatibility } from "../src/server/schema-compatibility";
import { searchProjection } from "../src/server/search-projection";
import { auditDeletedData, evidenceCheckpoint } from "./restore-evidence";

export const checkRestoreEvidence = async (state: RestoreState) => {
  if (!state.evidence) {
    throw new Error(
      "A complete independently retained fenced ledger checkpoint is required"
    );
  }
  const actual = await evidenceCheckpoint(
    state.instanceId,
    state.pendingIntents
  );
  if (
    actual.count !== state.evidence.count ||
    actual.digest !== state.evidence.digest
  ) {
    throw new Error(
      "Deletion evidence is behind or changed; keep admission closed"
    );
  }
  if (state.phase === "prepared") {
    for (const claims of state.pendingIntents) {
      if (
        (await readEvidence(state.instanceId, `intent:${claims.accountId}`)) !==
        JSON.stringify(claims)
      ) {
        throw new Error(
          "Prepared pending deletion evidence is missing or changed"
        );
      }
    }
  }
};

export const registerPendingRestore = async (
  state: RestoreState
): Promise<RestoreState> => {
  await ensureSchemaCompatibility(database(), true);
  await checkRestoreEvidence(state);
  const pendingIntents = [...state.pendingIntents];
  const registered = new Set(pendingIntents.map((claims) => claims.accountId));
  const rows =
    await database()`SELECT * FROM account_deletion_pending ORDER BY account_id`;
  for (const row of rows) {
    const claims = pendingClaims(row);
    if (claims.instanceId !== state.instanceId) {
      throw new Error("Pending deletion belongs to another instance");
    }
    if (
      !registered.has(claims.accountId) &&
      !(await readEvidence(state.instanceId, `intent:${claims.accountId}`))
    ) {
      pendingIntents.push(claims);
    }
  }
  return { ...state, pendingIntents };
};

export const prepareRestore = async (state: RestoreState) => {
  const sql = database();
  await ensureSchemaCompatibility(sql, true);
  await checkRestoreEvidence(state);
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
  for (const claims of state.pendingIntents) {
    await completeDeletion(claims);
  }
  await resumeDeletions();
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
