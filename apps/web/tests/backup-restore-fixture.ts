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

const deletionsCommand = [
  "bun",
  "--conditions=react-server",
  "apps/web/scripts/deletions.ts",
  "reapply",
];
/** The restore runbook's manual step: re-apply deletions from the deletion log. */
export const reapply = async (log: string) => {
  const child = Bun.spawn(deletionsCommand, {
    env: process.env,
    stdin: new Blob([log]),
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(child.stdout).text();
  assert.equal(await child.exited, 0, "Re-deletion failed");
  return output;
};
export const refusedReapply = async (log: string, reason: RegExp) => {
  const child = Bun.spawn(deletionsCommand, {
    env: process.env,
    stdin: new Blob([log]),
    stdout: "ignore",
    stderr: "pipe",
  });
  const message = await new Response(child.stderr).text();
  assert.notEqual(await child.exited, 0, "Failed re-deletion must be refused");
  assert.match(message, reason);
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
