// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Durable deletion boundaries and replay must complete sequentially.
import "server-only";
import { rmSync } from "node:fs";
import path from "node:path";

import { verifyDeletionReceipt } from "@pr0/api-client/deletions";
import { deletionClaimsSchema } from "@pr0/api-contract/deletions";
import type { DeletionClaims } from "@pr0/api-contract/deletions";

import { database } from "./database";
import {
  appendEvidence,
  readEvidence,
  replayEvidence,
} from "./deletion-ledger";
import { signingKeys, signDeletion } from "./deletion-signing";
import { purgeAccountMail } from "./mail";

export const deletionInstance = async () => {
  const [row] = await database()`SELECT id FROM instance`;
  if (!row) {
    throw new Error("Instance unavailable");
  }
  return String(row.id);
};
export const pendingClaims = (row: {
  instance_id: string;
  account_id: string;
  handle: string;
  deletion_id: string;
  deleted_at: Date;
}) =>
  deletionClaimsSchema.parse({
    version: 1,
    instanceId: row.instance_id,
    accountId: row.account_id,
    handle: row.handle,
    deletionId: row.deletion_id,
    deletedAt: row.deleted_at.toISOString(),
  });

const purgeLiveAccount = async (claims: DeletionClaims) => {
  const sql = database();
  await sql.begin(async (tx) => {
    const [owner] =
      await tx`SELECT id,email FROM "user" WHERE id=${claims.accountId} FOR UPDATE`;
    await tx`SELECT account_id FROM library WHERE account_id=${claims.accountId} FOR UPDATE`;
    if (owner) {
      await tx`UPDATE "user" SET deletion_pending=true WHERE id=${claims.accountId}`;
      await purgeAccountMail(tx, claims.accountId, owner.email);
      await tx`DELETE FROM verification WHERE value=${claims.accountId}
        OR CASE WHEN pg_input_is_valid(value,'jsonb') THEN
        jsonb_path_exists(value::jsonb,'$.** ? (@ == $accountId || @ == $email)',
          jsonb_build_object('accountId',${claims.accountId}::text,'email',${owner.email}::text)) ELSE false END`;
      await tx`DELETE FROM social_pending WHERE email=${owner.email} OR (provider,subject) IN
        (SELECT provider_id,account_id FROM account WHERE user_id=${claims.accountId})`;
      await tx`DELETE FROM registration_admission WHERE email=${owner.email}`;
      await tx`DELETE FROM admission_bucket WHERE position(${claims.accountId} in key)>0 OR position(${owner.email} in key)>0`;
      await tx`DELETE FROM request_work WHERE owner=${claims.accountId}`;
      await tx`DELETE FROM "user" WHERE id=${claims.accountId}`;
    }
  });
  // Index workers use the same cross-process lock before opening any files.
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${claims.accountId},56))`;
    const root = path.resolve(
      // oxlint-disable-next-line eslint/no-inline-comments -- Turbopack requires its directive inside the filesystem call.
      /* turbopackIgnore: true */ process.env.PR0_SEARCH_DIRECTORY ??
        ".data/search"
    );
    const stem = path.join(
      root,
      `${claims.instanceId}-${claims.accountId}.sqlite`
    );
    for (const suffix of [
      "",
      "-journal",
      "-wal",
      "-shm",
      ".building",
      ".building-journal",
      ".building-wal",
      ".building-shm",
    ]) {
      const target = path.resolve(`${stem}${suffix}`);
      if (path.dirname(target) !== root) {
        throw new Error("Invalid deletion path");
      }
      rmSync(target, { force: true });
    }
  });
};

export const completeDeletion = async (input: DeletionClaims) => {
  const claims = deletionClaimsSchema.parse(input);
  if (claims.instanceId !== (await deletionInstance())) {
    throw new Error("Deletion belongs to another instance");
  }
  // The same deletion ID/time is chosen at the barrier and survives all retries.
  await appendEvidence(
    claims.instanceId,
    `intent:${claims.accountId}`,
    JSON.stringify(claims)
  );
  const keys = await signingKeys(claims.instanceId);
  await purgeLiveAccount(claims);
  let receipt = await readEvidence(
    claims.instanceId,
    `receipt:${claims.handle}`
  );
  if (!receipt) {
    receipt = signDeletion(keys.current, claims);
    await appendEvidence(
      claims.instanceId,
      `receipt:${claims.handle}`,
      receipt
    );
  }
  await verifyDeletionReceipt(receipt, {
    ...claims,
    anchor: keys.anchor,
    rotations: keys.rotations,
  });
  await database()`DELETE FROM account_deletion_pending WHERE account_id=${claims.accountId}`;
  return { status: "deleted" as const, receipt };
};

export const resumeDeletions = async (replayCompleted = true) => {
  const instanceId = await deletionInstance();
  await signingKeys(instanceId);
  if (replayCompleted) {
    for await (const record of replayEvidence(instanceId, "intent:")) {
      const claims = deletionClaimsSchema.parse(JSON.parse(record.value));
      if (
        record.id !== `intent:${claims.accountId}` ||
        claims.instanceId !== instanceId
      ) {
        throw new Error("Invalid deletion evidence identity");
      }
      await completeDeletion(claims);
    }
  }
  const pending =
    await database()`SELECT * FROM account_deletion_pending ORDER BY account_id`;
  for (const row of pending) {
    await completeDeletion(pendingClaims(row));
  }
};
