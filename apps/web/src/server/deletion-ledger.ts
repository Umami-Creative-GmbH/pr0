// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Both independent commits must finish in order; replay scans immutable records by key.
import "server-only";
import { SQL } from "bun";
import { z } from "zod";

import { secret } from "./config";

const recordSchema = z.object({ id: z.string(), value: z.string() });
const connections = new Map<string, SQL>();
export const ledgerConnections = () =>
  ["PR0_LEDGER_A_URL", "PR0_LEDGER_B_URL"].map((name) => {
    let sql = connections.get(name);
    if (!sql) {
      sql = new SQL(secret(name), {
        max: 2,
        connectionTimeout: 3,
        idleTimeout: 5,
        connection: { statement_timeout: 5000, synchronous_commit: "on" },
      });
      connections.set(name, sql);
    }
    return sql;
  });

export const initializeLedgerStores = async () => {
  for (const sql of ledgerConnections()) {
    await sql.begin(async (tx) => {
      await tx`CREATE TABLE IF NOT EXISTS deletion_store (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), id uuid NOT NULL DEFAULT gen_random_uuid())`;
      await tx`INSERT INTO deletion_store(singleton) VALUES (true) ON CONFLICT DO NOTHING`;
      await tx`CREATE TABLE IF NOT EXISTS deletion_record (instance_id uuid NOT NULL, id text NOT NULL, value text NOT NULL, PRIMARY KEY(instance_id,id))`;
      await tx.unsafe(`CREATE OR REPLACE FUNCTION immutable_deletion_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Deletion evidence is append-only'; END; $$;
        DROP TRIGGER IF EXISTS immutable_deletion_record ON deletion_record;
        CREATE TRIGGER immutable_deletion_record BEFORE UPDATE OR DELETE OR TRUNCATE ON deletion_record FOR EACH STATEMENT EXECUTE FUNCTION immutable_deletion_record();`);
    });
  }
};

const assertIndependent = async () => {
  const stores = ledgerConnections();
  const identities = await Promise.all(
    stores.map(async (sql) => {
      const [store] = await sql`SELECT id FROM deletion_store`;
      // The ordinary service database must never be used as an evidence store.
      const [ordinary] =
        await sql`SELECT to_regclass('public.instance') IS NOT NULL AS present`;
      const [durability] =
        await sql`SELECT current_setting('fsync')='on' AND current_setting('full_page_writes')='on'
      AND current_setting('synchronous_commit')='on' AND (SELECT relpersistence='p' FROM pg_class WHERE oid='deletion_record'::regclass) AS durable`;
      if (!store || ordinary.present || !durability?.durable) {
        throw new Error("Independent ledger required");
      }
      return String(store.id);
    })
  );
  if (new Set(identities).size !== 2) {
    throw new Error("Distinct deletion stores required");
  }
  return stores;
};

export const appendEvidence = async (
  instanceId: string,
  id: string,
  value: string
) => {
  for (const sql of await assertIndependent()) {
    await sql.begin(async (tx) => {
      await tx`INSERT INTO deletion_record(instance_id,id,value) VALUES (${instanceId},${id},${value}) ON CONFLICT DO NOTHING`;
      const [stored] =
        await tx`SELECT value FROM deletion_record WHERE instance_id=${instanceId} AND id=${id}`;
      if (stored?.value !== value) {
        throw new Error("Deletion evidence collision");
      }
    });
  }
};

export const readEvidence = async (
  instanceId: string,
  id: string
): Promise<string | null> => {
  const stores = await assertIndependent();
  const values = await Promise.all(
    stores.map(async (sql) => {
      const [row] =
        await sql`SELECT value FROM deletion_record WHERE instance_id=${instanceId} AND id=${id}`;
      return row ? String(row.value) : null;
    })
  );
  const present = values.filter((value) => value !== null);
  if (new Set(present).size > 1) {
    throw new Error("Deletion evidence diverged");
  }
  const value = present[0] ?? null;
  if (value !== null && values.includes(null)) {
    await appendEvidence(instanceId, id, value);
  }
  return value;
};

export const replayEvidence = async function* replayEvidence(
  instanceId: string,
  prefix: string
) {
  const stores = await assertIndependent();
  let cursor = prefix;
  while (true) {
    const after = cursor;
    const pages = await Promise.all(
      stores.map(async (sql) =>
        z.array(recordSchema).parse(
          await sql`SELECT id,value FROM deletion_record WHERE instance_id=${instanceId}
        AND starts_with(id,${prefix}) AND id>${after} ORDER BY id LIMIT 100`
        )
      )
    );
    const ids = [...new Set(pages.flat().map((row) => row.id))]
      // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 types; this array is newly allocated.
      .sort()
      .slice(0, 100);
    if (!ids.length) {
      return;
    }
    for (const id of ids) {
      const value = await readEvidence(instanceId, id);
      if (value === null) {
        throw new Error("Incomplete deletion ledger");
      }
      yield { id, value };
      cursor = id;
    }
  }
};

export const closeLedgerStores = async () => {
  await Promise.all([...connections.values()].map((sql) => sql.close()));
  connections.clear();
};
