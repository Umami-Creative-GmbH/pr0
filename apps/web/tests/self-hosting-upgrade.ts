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
    "DROP TABLE deleted_accounts; CREATE TABLE account_deletion_pending (account_id text PRIMARY KEY, instance_id uuid NOT NULL, handle text NOT NULL UNIQUE, deletion_id uuid NOT NULL UNIQUE, deleted_at timestamptz(3) NOT NULL); ALTER TABLE instance ADD COLUMN deletion_anchor text; UPDATE instance SET minimum_server_migration=20; DELETE FROM migration WHERE version=21; UPDATE migration_control SET completed=20,phase='ready' WHERE singleton=1;"
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
