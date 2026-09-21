// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Backup verification, retention and publication are ordered durability boundaries.
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmdirSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { secret } from "../src/server/config";
import { database } from "../src/server/database";
import { readRestoreState } from "../src/server/restore-state";
import { decryptBackup, encryptBackup, flushDirectory } from "./backup-crypto";
import {
  backupManifestSchema,
  postgresEnvironment,
  restoreDump,
  verifyDump,
} from "./backup-database";

const archivePattern = /^(?<timestamp>\d{13})-[0-9a-f-]{36}$/u;
const retentionMs = 29 * 24 * 60 * 60 * 1000;
const configPattern =
  /^(?:PR0_|SMTP_|BETTER_AUTH_|DATABASE_URL$|API_ALLOWED_ORIGINS$|PGSSL)/u;
const excludedPattern =
  /^PR0_(?:BACKUP_|TEST_|RECOVERY_STATE_FILE|MIGRATION_BACKUPS|DATABASE_VOLUME)/u;

const recoverableConfiguration = () => {
  const result: Record<string, string> = {};
  for (const name of Object.keys(process.env)) {
    if (!configPattern.test(name) || excludedPattern.test(name)) {
      continue;
    }
    const key = name.endsWith("_FILE") ? name.slice(0, -5) : name;
    if (process.env[name]) {
      result[key] = secret(key);
    }
  }
  return result;
};

const root = () => {
  const value = process.env.PR0_BACKUP_DIRECTORY;
  if (!value || !lstatSync(value).isDirectory()) {
    throw new Error("Mount the dedicated off-server backup directory first");
  }
  return path.resolve(value);
};
const archivePath = (name: string) => {
  if (!archivePattern.test(name)) {
    throw new Error("Invalid backup identifier");
  }
  const directory = path.join(root(), name);
  if (!lstatSync(directory).isDirectory()) {
    throw new Error("Backup must be a real directory, not a link");
  }
  return directory;
};

const inScratch = async <T>(operation: (directory: string) => Promise<T>) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pr0-backup-"));
  try {
    return await operation(directory);
  } finally {
    // Only these exact files are ever created here; unexpected contents fail cleanup visibly.
    for (const name of ["manifest.json", "database.dump"]) {
      const filename = path.join(directory, name);
      if (await Bun.file(filename).exists()) {
        unlinkSync(filename);
      }
    }
    rmdirSync(directory);
  }
};

const readArchive = async (name: string, scratch: string) => {
  const directory = archivePath(name);
  await decryptBackup(
    path.join(directory, "manifest.enc"),
    path.join(scratch, "manifest.json"),
    `${name}:manifest`
  );
  const manifest = backupManifestSchema.parse(
    await Bun.file(path.join(scratch, "manifest.json")).json()
  );
  if (`${Date.parse(manifest.checkpoint)}-${manifest.id}` !== name) {
    throw new Error("Backup checkpoint identity changed");
  }
  const available = statfsSync(scratch, { bigint: true });
  if (
    available.bavail * available.bsize <
    BigInt(manifest.databaseBytes) * 3n + 16_777_216n
  ) {
    throw new Error("Insufficient measured verification scratch space");
  }
  const dump = path.join(scratch, "database.dump");
  await decryptBackup(
    path.join(directory, "database.enc"),
    dump,
    `${name}:database`
  );
  return { manifest, dump };
};

const cleanupRetention = () => {
  for (const name of readdirSync(root())) {
    const match = archivePattern.exec(name);
    if (!match) {
      throw new Error(
        "Unmanaged object in dedicated backup directory; retention requires inspection"
      );
    }
    const directory = archivePath(name);
    if (Number(match.groups?.timestamp) >= Date.now() - retentionMs) {
      continue;
    }
    for (const file of readdirSync(directory)) {
      if (
        !["database.enc", "manifest.enc"].includes(file) ||
        !lstatSync(path.join(directory, file)).isFile()
      ) {
        throw new Error("Unmanaged backup object; retention cleanup failed");
      }
      unlinkSync(path.join(directory, file));
    }
    rmdirSync(directory);
  }
};

const createBackup = async () => {
  const sql = database();
  const [instance] = await sql`SELECT id,recovery_epoch FROM instance`;
  const migrations = await sql<
    { version: number; digest: string }[]
  >`SELECT version,digest FROM migration ORDER BY version`;
  const [size] =
    await sql`SELECT pg_database_size(current_database())::text AS bytes`;
  const manifest = backupManifestSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    checkpoint: new Date().toISOString(),
    release: process.env.PR0_BACKUP_RELEASE,
    instanceId: instance.id,
    epoch: instance.recovery_epoch,
    databaseBytes: size.bytes,
    migrations,
    configuration: recoverableConfiguration(),
  });
  const name = `${Date.parse(manifest.checkpoint)}-${manifest.id}`;
  const directory = path.join(root(), name);
  const space = statfsSync(root(), { bigint: true });
  if (
    space.bavail * space.bsize <
    BigInt(manifest.databaseBytes) + 16_777_216n
  ) {
    throw new Error("Insufficient measured backup space");
  }
  mkdirSync(directory, { mode: 0o700 });
  const child = Bun.spawn(
    ["pg_dump", "--format=custom", "--no-owner", "--no-acl"],
    {
      env: postgresEnvironment(),
      stdout: "pipe",
      stderr: "ignore",
    }
  );
  try {
    await encryptBackup(
      child.stdout,
      path.join(directory, "database.enc"),
      `${name}:database`
    );
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  }
  if ((await child.exited) !== 0) {
    throw new Error("Database backup failed");
  }
  await encryptBackup(
    new Blob([JSON.stringify(manifest)]).stream(),
    path.join(directory, "manifest.enc"),
    `${name}:manifest`
  );
  flushDirectory(directory);
  flushDirectory(root());
  await inScratch(async (scratch) => {
    const recovered = await readArchive(name, scratch);
    await verifyDump(recovered.dump, recovered.manifest);
  });
  cleanupRetention();
  flushDirectory(root());
  await sql`INSERT INTO backup_observation(checkpoint,retention_ok,verified_at) VALUES (${new Date(manifest.checkpoint)},true,clock_timestamp())
    ON CONFLICT(singleton) DO UPDATE SET checkpoint=excluded.checkpoint,retention_ok=true,verified_at=excluded.verified_at`;
  return {
    event: "backup_verified",
    archive: name,
    checkpoint: manifest.checkpoint,
  };
};

const consumeBackup = (command: string, name: string, destination?: string) =>
  inScratch(async (scratch) => {
    const { manifest, dump } = await readArchive(name, scratch);
    await verifyDump(dump, manifest);
    if (command === "restore") {
      const state = readRestoreState();
      if (
        !state ||
        state.phase !== "closed" ||
        state.instanceId !== manifest.instanceId ||
        process.env.PR0_BACKUP_RELEASE !== manifest.release
      ) {
        throw new Error(
          "A closed recovery barrier and matching application release are required"
        );
      }
      const tables =
        await database()`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' LIMIT 1`;
      if (tables.length) {
        throw new Error(
          "Restore requires an empty replacement database; never overwrite a running instance"
        );
      }
      await restoreDump(dump);
    } else if (command === "configuration") {
      if (!destination) {
        throw new Error("Supply a private new configuration output file");
      }
      writeFileSync(
        destination,
        JSON.stringify(
          {
            instanceId: manifest.instanceId,
            release: manifest.release,
            configuration: manifest.configuration,
          },
          null,
          2
        ),
        { flag: "wx", mode: 0o600 }
      );
    }
    return {
      event: `backup_${command}_verified`,
      archive: name,
      checkpoint: manifest.checkpoint,
    };
  });

try {
  const [command, name, destination] = process.argv.slice(2);
  if (command === "create") {
    process.stdout.write(`${JSON.stringify(await createBackup())}\n`);
  } else if (
    ["verify", "restore", "configuration"].includes(command ?? "") &&
    name
  ) {
    process.stdout.write(
      `${JSON.stringify(await consumeBackup(command ?? "", name, destination))}\n`
    );
  } else if (command === "retention") {
    cleanupRetention();
    process.stdout.write('{"event":"backup_retention_complete"}\n');
  } else {
    throw new Error(
      "Use create, verify <archive>, restore <archive>, configuration <archive> <new-file>, or retention"
    );
  }
} catch {
  try {
    await database()`UPDATE backup_observation SET retention_ok=false`;
  } catch {
    // A down database cannot acknowledge an observation; stderr/nonzero is the external alert signal.
  }
  process.stderr.write(
    '{"event":"backup_failed","action":"Keep admission closed during recovery; inspect backup, key, free space and retention"}\n'
  );
  process.exitCode = 1;
} finally {
  await database().close();
}
