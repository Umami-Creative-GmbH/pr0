import { statfsSync } from "node:fs";

/** Headroom on top of three times the database size: dump, restore check and slack. */
const scratchHeadroomBytes = 16_777_216n;

const availableBytes = (location: string) => {
  const space = statfsSync(location, { bigint: true });
  return space.bavail * space.bsize;
};

/**
 * Where the pre-migration backup is written and which filesystems must have
 * room for it. PR0_DATABASE_VOLUME is optional: a deployment that cannot mount
 * the database's data volume (the hosted Coolify-managed database) monitors
 * that disk on the server instead.
 */
export const migrationScratch = (
  env: Record<string, string | undefined> = process.env
) => {
  const directory = env.PR0_MIGRATION_BACKUPS;
  if (!directory) {
    throw new Error(
      "Configure PR0_MIGRATION_BACKUPS (and PR0_DATABASE_VOLUME where the database's data volume is mounted) before upgrading"
    );
  }
  const volume = env.PR0_DATABASE_VOLUME;
  return { directory, locations: volume ? [directory, volume] : [directory] };
};

/** Each location needs three times the database size plus 16 MiB free. */
export const assertMigrationScratchSpace = (
  locations: string[],
  databaseBytes: bigint,
  available: (location: string) => bigint = availableBytes
) => {
  for (const location of locations) {
    if (available(location) < databaseBytes * 3n + scratchHeadroomBytes) {
      throw new Error(
        "Insufficient measured migration scratch space; free space and retry"
      );
    }
  }
};
