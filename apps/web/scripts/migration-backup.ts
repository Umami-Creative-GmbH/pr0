import { closeSync, fsyncSync, mkdirSync, openSync, statfsSync } from "node:fs";
import path from "node:path";

import type { ReservedSQL } from "bun";

import { secret } from "../src/server/config";

export const backupBeforeMigration = async (sql: ReservedSQL) => {
  const directory = process.env.PR0_MIGRATION_BACKUPS;
  const volume = process.env.PR0_DATABASE_VOLUME;
  if (!directory || !volume) {
    throw new Error(
      "Configure PR0_MIGRATION_BACKUPS and PR0_DATABASE_VOLUME on the database host before upgrading"
    );
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const [measured] =
    await sql`SELECT pg_database_size(current_database())::text AS bytes`;
  const bytes = BigInt(measured.bytes);
  for (const location of [directory, volume]) {
    const space = statfsSync(location, { bigint: true });
    if (space.bavail * space.bsize < bytes * 3n + 16_777_216n) {
      throw new Error(
        "Insufficient measured migration scratch space; free space and retry"
      );
    }
  }
  const filename = path.join(
    directory,
    `migration-${Date.now()}-${crypto.randomUUID()}.dump`
  );
  const connection = new URL(secret("DATABASE_URL"));
  const env = {
    ...process.env,
    PGHOST: connection.hostname,
    PGPORT: connection.port || "5432",
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
    PGSSLMODE:
      connection.searchParams.get("sslmode") ??
      process.env.PGSSLMODE ??
      "prefer",
  };
  const fd = openSync(filename, "wx", 0o600);
  try {
    const process = Bun.spawn(
      ["pg_dump", "--format=custom", "--no-owner", "--no-acl"],
      { env, stdout: fd, stderr: "ignore" }
    );
    if ((await process.exited) !== 0) {
      throw new Error("Migration backup failed; admission remains closed");
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const directoryFd = openSync(directory, "r");
  try {
    fsyncSync(directoryFd);
  } finally {
    closeSync(directoryFd);
  }
  const inspect = Bun.spawn(["pg_restore", "--list", filename], {
    env,
    stdout: "ignore",
    stderr: "ignore",
  });
  if ((await inspect.exited) !== 0) {
    throw new Error(
      "Migration backup verification failed; admission remains closed"
    );
  }
  const hash = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(filename).stream().getReader();
  // oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Hash bounded chunks without allocating the backup in memory.
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    hash.update(chunk.value);
  }
  return JSON.stringify({
    file: path.basename(filename),
    sha256: hash.digest("hex"),
    databaseBytes: bytes.toString(),
  });
};
