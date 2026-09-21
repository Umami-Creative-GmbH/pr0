// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Enumerate and verify bounded evidence pages in canonical order.
import { existsSync } from "node:fs";

import { verifyDeletionReceipt } from "@pr0/api-client/deletions";
import { deletionClaimsSchema } from "@pr0/api-contract/deletions";
import type { DeletionClaims } from "@pr0/api-contract/deletions";

import { database } from "../src/server/database";
import { readEvidence, replayEvidence } from "../src/server/deletion-ledger";
import { signingKeys } from "../src/server/deletion-signing";
import { searchFilename } from "../src/server/search-location";

export const evidenceCheckpoint = async (
  instanceId: string,
  pendingIntents: DeletionClaims[] = []
) => {
  const additions = new Map(
    pendingIntents.map((claims) => [
      `intent:${claims.accountId}`,
      JSON.stringify(claims),
    ])
  );
  const keys = await signingKeys(instanceId);
  const hash = new Bun.CryptoHasher("sha256");
  let count = 0;
  let keyCount = 0;
  for await (const record of replayEvidence(instanceId, "")) {
    if (record.id.startsWith("receipt:")) {
      continue;
    }
    if (record.id.startsWith("key:")) {
      keyCount += 1;
    } else if (record.id.startsWith("intent:")) {
      const claims = deletionClaimsSchema.parse(JSON.parse(record.value));
      if (
        claims.instanceId !== instanceId ||
        record.id !== `intent:${claims.accountId}`
      ) {
        throw new Error("Invalid evidence identity");
      }
    } else {
      throw new Error("Unknown evidence record");
    }
    const addition = additions.get(record.id);
    if (addition !== undefined) {
      if (record.value !== addition) {
        throw new Error("Pending deletion evidence changed");
      }
      continue;
    }
    hash.update(JSON.stringify([record.id, record.value]));
    count += 1;
  }
  if (keyCount !== keys.generation) {
    throw new Error("Incomplete signing key history");
  }
  return { count, digest: hash.digest("hex") };
};

export const auditDeletedData = async (instanceId: string) => {
  const keys = await signingKeys(instanceId);
  const sql = database();
  // Independently discover all canonical ownership columns, including future tables.
  const tables = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
    AND (column_name IN ('account_id','user_id') OR (table_name='user' AND column_name='id'))`;
  let deleted = 0;
  for await (const record of replayEvidence(instanceId, "intent:")) {
    const claims = deletionClaimsSchema.parse(JSON.parse(record.value));
    const receipt = await readEvidence(instanceId, `receipt:${claims.handle}`);
    if (!receipt) {
      throw new Error("Deletion completion missing");
    }
    const verified = await verifyDeletionReceipt(receipt, {
      ...claims,
      anchor: keys.anchor,
      rotations: keys.rotations,
    });
    if (
      verified.deletionId !== claims.deletionId ||
      verified.deletedAt !== claims.deletedAt
    ) {
      throw new Error("Deletion completion differs from intent");
    }
    for (const table of tables) {
      const name = table.table_name.replaceAll('"', '""');
      const column = table.column_name.replaceAll('"', '""');
      const rows = await sql.unsafe(
        `SELECT 1 FROM public."${name}" WHERE "${column}"::text=$1 LIMIT 1`,
        [claims.accountId]
      );
      if (rows.length) {
        throw new Error("Deleted canonical data remains");
      }
    }
    const filename = searchFilename(instanceId, claims.accountId);
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
    deleted += 1;
  }
  for await (const record of replayEvidence(instanceId, "receipt:")) {
    const claims = deletionClaimsSchema.parse(
      JSON.parse(
        Buffer.from(record.value.split(".")[1] ?? "", "base64url").toString(
          "utf-8"
        )
      )
    );
    const intent = await readEvidence(instanceId, `intent:${claims.accountId}`);
    if (!intent || record.id !== `receipt:${claims.handle}`) {
      throw new Error("Receipt without complete intent history");
    }
    await verifyDeletionReceipt(record.value, {
      ...claims,
      instanceId,
      anchor: keys.anchor,
      rotations: keys.rotations,
    });
  }
  return deleted;
};
