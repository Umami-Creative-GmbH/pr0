import { expect, test } from "bun:test";

import {
  assertMigrationScratchSpace,
  migrationScratch,
} from "./migration-scratch";

const databaseBytes = 1_000_000n;
const required = databaseBytes * 3n + 16_777_216n;
const insufficient = /Insufficient measured migration scratch space/u;

test("with PR0_DATABASE_VOLUME set, both the backup directory and the database volume need room", () => {
  const { directory, locations } = migrationScratch({
    PR0_MIGRATION_BACKUPS: "/var/lib/pr0-backups",
    PR0_DATABASE_VOLUME: "/var/lib/postgresql/data",
  });
  expect(directory).toBe("/var/lib/pr0-backups");
  expect(locations).toEqual([
    "/var/lib/pr0-backups",
    "/var/lib/postgresql/data",
  ]);

  const checked: string[] = [];
  assertMigrationScratchSpace(locations, databaseBytes, (location) => {
    checked.push(location);
    return required;
  });
  expect(checked).toEqual(locations);

  expect(() =>
    assertMigrationScratchSpace(locations, databaseBytes, (location) =>
      location === "/var/lib/postgresql/data" ? required - 1n : required
    )
  ).toThrow(insufficient);
});

test("without PR0_DATABASE_VOLUME, only the backup directory is checked", () => {
  const { locations } = migrationScratch({
    PR0_MIGRATION_BACKUPS: "/var/lib/pr0-backups",
  });
  expect(locations).toEqual(["/var/lib/pr0-backups"]);

  const checked: string[] = [];
  assertMigrationScratchSpace(locations, databaseBytes, (location) => {
    checked.push(location);
    return required;
  });
  expect(checked).toEqual(["/var/lib/pr0-backups"]);

  expect(() =>
    assertMigrationScratchSpace(locations, databaseBytes, () => required - 1n)
  ).toThrow(insufficient);
});

test("PR0_MIGRATION_BACKUPS is still required", () => {
  for (const env of [
    {},
    { PR0_DATABASE_VOLUME: "/var/lib/postgresql/data" },
    { PR0_MIGRATION_BACKUPS: "" },
  ]) {
    expect(() => migrationScratch(env)).toThrow(
      "Configure PR0_MIGRATION_BACKUPS (and PR0_DATABASE_VOLUME where the database's data volume is mounted) before upgrading"
    );
  }
});

test("the real filesystem measurement accepts a directory with room", () => {
  expect(() =>
    assertMigrationScratchSpace([import.meta.dir], 0n)
  ).not.toThrow();
});
