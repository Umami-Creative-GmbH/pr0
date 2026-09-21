import assert from "node:assert/strict";

import type { SQL } from "bun";

import type { accountTestServer } from "./account-test-server";
import { runAcceptance } from "./account-test-server";
import { origin } from "./http-fixture";
import { promptBrowser, promptClient, promptOperation } from "./prompt-fixture";

const compose = [
  "docker",
  "compose",
  "-p",
  "pr0-compatibility-58",
  "-f",
  "apps/web/tests/compatibility-compose.yaml",
];
const refused = async (command: string[]) => {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [status, output] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  assert.notEqual(status, 0, "unsafe migration must fail");
  return output;
};

export const verifyServerUpgrade = async (
  sql: SQL,
  server: ReturnType<typeof accountTestServer>
) => {
  const browser = await promptBrowser();
  const client = promptClient(browser.Cookie);
  const operation = promptOperation({
    title: "Upgrade preservation",
    description: "",
    content: "  Exact ß é variant\n",
  });
  const envelope = { ...browser.identity, operations: [operation] };
  const receipt = await client.mutatePrompts(envelope);
  const prompt = await client.getPrompt(operation.promptId);
  // Fixture setup: reconstruct the immediately preceding deployed server schema.
  await server.stopServer();
  await server.stopMail();
  await sql`ALTER TABLE instance DROP COLUMN minimum_server_migration`;
  await sql`DELETE FROM migration WHERE version=20`;
  await sql`UPDATE migration_control SET completed=19,phase='ready' WHERE singleton=1`;
  const coordinator = await sql.reserve();
  try {
    await coordinator`SELECT pg_advisory_lock(24001)`;
    const output = await refused([
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/accounts.ts",
      "migrate",
    ]);
    assert.match(output, /Another migration coordinator/u);
  } finally {
    await coordinator`SELECT pg_advisory_unlock(24001)`;
    coordinator.release();
  }
  const failure = await refused([
    ...compose,
    "run",
    "--rm",
    "-e",
    "PR0_MIGRATION_BACKUPS=/proc/pr0-backup-denied",
    "migrate",
  ]);
  assert.ok(failure.length > 0);
  const [checkpoint] =
    await sql`SELECT phase,completed FROM migration_control WHERE singleton=1`;
  assert.equal(checkpoint.phase, "preflight");
  assert.equal(checkpoint.completed, 19);
  await runAcceptance([...compose, "run", "--rm", "migrate"]);
  const [backup] =
    await sql`SELECT backup,phase,completed FROM migration_control WHERE singleton=1`;
  assert.match(backup.backup, /sha256/u);
  assert.equal(backup.completed, 20);
  assert.equal(backup.phase, "ready");
  server.startMail();
  await server.startServer();
  assert.deepEqual(await client.getPrompt(operation.promptId), prompt);
  assert.deepEqual(await client.mutatePrompts(envelope), receipt);
  // A contract migration raises the minimum binary; reads must safely stop.
  await sql`UPDATE instance SET minimum_server_migration=21`;
  const incompatible = await fetch(`${origin}/api/v1/capabilities`);
  assert.equal(incompatible.status, 503);
  await sql`UPDATE instance SET minimum_server_migration=20`;
  assert.deepEqual(await client.getPrompt(operation.promptId), prompt);
};
