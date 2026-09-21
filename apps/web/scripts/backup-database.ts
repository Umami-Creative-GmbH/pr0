import { SQL } from "bun";
import { z } from "zod";

import { secret } from "../src/server/config";

export const backupManifestSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  checkpoint: z.iso.datetime(),
  release: z.string().min(1),
  instanceId: z.uuid(),
  epoch: z.uuid(),
  migrations: z.array(
    z.object({ version: z.number().int(), digest: z.string() })
  ),
  databaseBytes: z.string(),
  configuration: z.record(z.string(), z.string()),
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;

export const postgresEnvironment = (databaseName?: string) => {
  const connection = new URL(secret("DATABASE_URL"));
  return {
    ...process.env,
    PGHOST: connection.hostname,
    PGPORT: connection.port || "5432",
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGDATABASE:
      databaseName ?? decodeURIComponent(connection.pathname.slice(1)),
    PGSSLMODE:
      connection.searchParams.get("sslmode") ??
      process.env.PGSSLMODE ??
      "prefer",
  };
};

export const restoreDump = async (filename: string, databaseName?: string) => {
  const child = Bun.spawn(
    [
      "pg_restore",
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-acl",
      "--dbname",
      databaseName ?? postgresEnvironment().PGDATABASE,
      filename,
    ],
    {
      env: postgresEnvironment(databaseName),
      stdout: "ignore",
      stderr: "ignore",
    }
  );
  if ((await child.exited) !== 0) {
    throw new Error("Database restore failed; keep admission closed");
  }
};

export const verifyDump = async (
  filename: string,
  manifest: BackupManifest
) => {
  const admin = new SQL(secret("DATABASE_URL"));
  const name = `pr0_verify_${crypto.randomUUID().replaceAll("-", "")}`;
  const connection = new URL(secret("DATABASE_URL"));
  connection.pathname = `/${name}`;
  const scratch = new SQL(connection.toString());
  let created = false;
  try {
    // The only interpolated identifier is generated locally, never supplied by an archive.
    await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE template0`);
    created = true;
    await restoreDump(filename, name);
    const [identity] = await scratch`SELECT id,recovery_epoch FROM instance`;
    const migrations =
      await scratch`SELECT version,digest FROM migration ORDER BY version`;
    if (
      identity?.id !== manifest.instanceId ||
      identity.recovery_epoch !== manifest.epoch ||
      JSON.stringify(migrations) !== JSON.stringify(manifest.migrations)
    ) {
      throw new Error(
        "Restored identity or migration checksums differ from manifest"
      );
    }
    // pg_restore has applied every table, index and constraint in a real independent database.
    await scratch`SELECT count(*) FROM prompt`;
  } finally {
    await scratch.close();
    if (created) {
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    }
    await admin.close();
  }
};
