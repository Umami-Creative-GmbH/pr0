import assert from "node:assert/strict";

import { selfHostingClient } from "./self-hosting-client";
import type { SelfHostingInstance } from "./self-hosting-fixture";

export const verifySelfHostingUpgrade = async (
  instance: SelfHostingInstance,
  cookie: string,
  promptId: string
) => {
  const before = await instance.library(cookie);
  const original = await selfHostingClient(instance, cookie).getPrompt(
    promptId
  );
  await instance.compose("stop", "web", "mail");
  // Fixture setup reconstructs the immediately preceding deployed schema.
  // Preservation and closed admission are observed only through public REST.
  await instance.compose(
    "exec",
    "-T",
    "database",
    "psql",
    "-U",
    "pr0",
    "-d",
    "pr0",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "ALTER TABLE instance DROP COLUMN minimum_server_migration; DELETE FROM migration WHERE version=20; UPDATE migration_control SET completed=19,phase='ready' WHERE singleton=1;"
  );
  await assert.rejects(
    instance.compose(
      "run",
      "--rm",
      "-e",
      "PR0_MIGRATION_BACKUPS=/proc/pr0-denied",
      "accounts",
      "migrate"
    )
  );
  await instance.compose("up", "-d", "--no-build", "web", "mail");
  await instance.ready(503);
  const refused = await instance.request("/api/v1/library", undefined, cookie);
  assert.equal(refused.status, 503);
  await instance.compose("stop", "web", "mail");
  await instance.compose("run", "--rm", "accounts", "migrate");
  await instance.compose("run", "--rm", "deletions", "replay");
  await instance.compose(
    "up",
    "-d",
    "--no-build",
    "--force-recreate",
    "web",
    "mail"
  );
  await instance.ready();
  const after = await instance.library(cookie);
  assert.equal(after.instance.id, before.instance.id);
  assert.equal(after.account.id, before.account.id);
  assert.deepEqual(
    await selfHostingClient(instance, cookie).getPrompt(promptId),
    original
  );
};
