// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Ordered DDL and drain checkpoints must execute sequentially under one coordinator lock.
import type { SQL } from "bun";

import { serverMigrationVersion } from "../src/server/schema-compatibility";
import { backupBeforeMigration } from "./migration-backup";

const filenames = [
  "001-accounts.sql",
  "002-request-work.sql",
  "003-email-admission.sql",
  "004-session-issuance.sql",
  "005-social.sql",
  "006-email-change.sql",
  "007-prompts.sql",
  "008-prompt-edits.sql",
  "009-prompt-lifecycle.sql",
  "010-prompt-deletion.sql",
  "011-collections.sql",
  "012-tags.sql",
  "013-organization-cleanup.sql",
  "014-prompt-use.sql",
  "015-account-deletion.sql",
  "016-device.sql",
  "017-snapshots.sql",
  "018-live-changes.sql",
  "019-service-operations.sql",
  "020-compatible-upgrades.sql",
];

export const migrate = async (pool: SQL) => {
  const migrations = await Promise.all(
    filenames.map(async (name, index) => {
      const source = await Bun.file(
        new URL(`../migrations/${name}`, import.meta.url)
      ).text();
      return {
        version: index + 1,
        source,
        digest: new Bun.CryptoHasher("sha256").update(source).digest("hex"),
      };
    })
  );
  const sql = await pool.reserve();
  let locked = false;
  try {
    const [lock] = await sql`SELECT pg_try_advisory_lock(24001) AS acquired`;
    if (!lock.acquired) {
      throw new Error(
        "Another migration coordinator is active; retry after it finishes"
      );
    }
    locked = true;
    await sql`SET statement_timeout=0`;
    await sql`CREATE TABLE IF NOT EXISTS migration (version integer PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = await sql<
      { version: number; digest: string }[]
    >`SELECT version,digest FROM migration ORDER BY version`;
    if (
      applied.some(
        (row, index) =>
          row.version !== index + 1 || migrations[index]?.digest !== row.digest
      )
    ) {
      throw new Error(
        "Unknown, noncontiguous or changed server migration; use a compatible binary, never downgrade"
      );
    }
    await sql`CREATE TABLE IF NOT EXISTS migration_control(singleton integer PRIMARY KEY CHECK(singleton=1),phase text NOT NULL,target integer NOT NULL,completed integer NOT NULL,backup text,updated_at timestamptz NOT NULL DEFAULT now())`;
    const [state] =
      await sql`SELECT phase,completed FROM migration_control WHERE singleton=1`;
    if (
      applied.length === migrations.length &&
      state?.phase === "ready" &&
      state.completed === serverMigrationVersion
    ) {
      return;
    }
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(24005)`;
      await tx`INSERT INTO migration_control(singleton,phase,target,completed) VALUES(1,'draining',${serverMigrationVersion},${applied.length}) ON CONFLICT(singleton) DO UPDATE SET phase='draining',target=excluded.target,updated_at=now()`;
    });
    if (applied.length >= 2) {
      const deadline = Date.now() + 60_000;
      while (true) {
        const [active] =
          await sql`SELECT count(*)::int AS count FROM request_work WHERE active AND expires_at>now()`;
        if (!active.count) {
          break;
        }
        if (Date.now() >= deadline) {
          throw new Error(
            "Requests did not drain; stop application workers and retry migration"
          );
        }
        await Bun.sleep(100);
      }
    }
    await sql`UPDATE migration_control SET phase='preflight',updated_at=now() WHERE singleton=1`;
    if (applied.length && applied.length < migrations.length) {
      const backup = await backupBeforeMigration(sql);
      await sql`UPDATE migration_control SET backup=${backup},updated_at=now() WHERE singleton=1`;
    }
    await sql`UPDATE migration_control SET phase='migrating',updated_at=now() WHERE singleton=1`;
    for (const migration of migrations.slice(applied.length)) {
      await sql.begin(async (tx) => {
        await tx.unsafe(migration.source);
        if (migration.version === 1) {
          await tx`INSERT INTO instance(id,schema_version) VALUES(${crypto.randomUUID()},1)`;
        }
        await tx`INSERT INTO migration(version,digest) VALUES(${migration.version},${migration.digest})`;
        await tx`UPDATE migration_control SET completed=${migration.version},updated_at=now() WHERE singleton=1`;
      });
    }
    await sql`UPDATE migration_control SET phase='ready',updated_at=now() WHERE singleton=1`;
  } finally {
    if (locked) {
      await sql`SELECT pg_advisory_unlock(24001)`;
    }
    sql.release();
  }
};
