import assert from "node:assert/strict";

import { z } from "zod";

import { runAcceptance } from "./account-test-server";
import { origin } from "./http-fixture";

export const resetRehearsalDatabase = async () => {
  const target = ["docker", "exec", "pr0-restore-61-database-1"];
  await runAcceptance([...target, "dropdb", "-U", "pr0", "--force", "pr0"]);
  await runAcceptance([...target, "createdb", "-U", "pr0", "pr0"]);
};

export const restoreCommand = (command: string) =>
  runAcceptance([
    "bun",
    "--conditions=react-server",
    "apps/web/scripts/restore.ts",
    command,
  ]);
export const refusedRestore = async (
  command: string,
  reason: RegExp,
  env: Record<string, string> = {}
) => {
  const child = Bun.spawn(
    [
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/restore.ts",
      command,
    ],
    {
      env: { ...process.env, ...env },
      stdout: "ignore",
      stderr: "pipe",
    }
  );
  const message = await new Response(child.stderr).text();
  assert.notEqual(await child.exited, 0, "Unsafe restore must be refused");
  assert.match(message, reason);
};

export const backupCompose = [
  "docker",
  "compose",
  "-p",
  "pr0-restore-61",
  "-f",
  "apps/web/tests/backup-restore-compose.yaml",
];
export const backupCommand = async (...args: string[]) => {
  const child = Bun.spawn(
    [
      ...backupCompose,
      "run",
      "--rm",
      "-e",
      `BETTER_AUTH_SECRET=${process.env.BETTER_AUTH_SECRET ?? ""}`,
      "backup",
      ...args,
    ],
    {
      env: process.env,
      stdout: "pipe",
      stderr: "inherit",
    }
  );
  const result = await new Response(child.stdout).text();
  assert.equal(await child.exited, 0);
  return z
    .object({
      event: z.string(),
      archive: z.string(),
      checkpoint: z.iso.datetime(),
    })
    .parse(JSON.parse(result));
};

export const ledgerSnapshot = async (service: "ledger-a" | "ledger-b") => {
  const child = Bun.spawn(
    [
      "docker",
      "exec",
      `pr0-restore-61-${service}-1`,
      "pg_dump",
      "-U",
      "pr0",
      "--clean",
      "--if-exists",
      "--no-owner",
      "ledger",
    ],
    { stdout: "pipe", stderr: "inherit" }
  );
  const dump = await new Response(child.stdout).text();
  assert.equal(await child.exited, 0);
  return dump;
};
export const restoreLedgerFixture = async (
  service: "ledger-a" | "ledger-b",
  dump: string
) => {
  const child = Bun.spawn(
    [
      "docker",
      "exec",
      "-i",
      `pr0-restore-61-${service}-1`,
      "psql",
      "-U",
      "pr0",
      "-d",
      "ledger",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      stdin: new Blob([dump]),
      stdout: "ignore",
      stderr: "inherit",
    }
  );
  assert.equal(await child.exited, 0);
};

export const assertHttpStatus = async (
  route: string,
  status: number,
  Cookie?: string
) => {
  const response = await fetch(`${origin}${route}`, {
    headers: Cookie ? { Cookie } : {},
  });
  assert.equal(response.status, status, route);
};
