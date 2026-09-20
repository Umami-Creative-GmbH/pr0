import { deletionTrustSchema } from "@pr0/api-contract/deletions";

import { runAcceptance } from "./account-test-server";
import type { accountTestServer } from "./account-test-server";
import { freshSocialBrowser } from "./email-change-fixture";
import { origin, post } from "./http-fixture";

const snapshot = async (service: "database" | "ledger-b") => {
  const child = Bun.spawn(
    [
      "docker",
      "exec",
      `pr0-deletion-56-${service}-1`,
      "pg_dump",
      "-U",
      "pr0",
      "-d",
      service === "database" ? "pr0" : "ledger",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
    ],
    { stdout: "pipe", stderr: "inherit" }
  );
  const dump = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) {
    throw new Error("Disposable restore snapshot failed");
  }
  return dump;
};
const restore = async (service: "database" | "ledger-b", dump: string) => {
  const child = Bun.spawn(
    [
      "docker",
      "exec",
      "-i",
      `pr0-deletion-56-${service}-1`,
      "psql",
      "-U",
      "pr0",
      "-d",
      service === "database" ? "pr0" : "ledger",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { stdin: new Blob([dump]), stdout: "ignore", stderr: "inherit" }
  );
  if ((await child.exited) !== 0) {
    throw new Error("Disposable database restore failed");
  }
};

export const deletionRestoreScenario = async (
  server: ReturnType<typeof accountTestServer>
) => {
  const account = await freshSocialBrowser();
  const response = await fetch(`${origin}/api/v1/account/deletion`, {
    headers: { Cookie: account.Cookie },
  });
  const trust = deletionTrustSchema.parse(await response.json());
  const [ordinary, ledger] = await Promise.all([
    snapshot("database"),
    snapshot("ledger-b"),
  ]);
  const deletion = await post(
    "/api/v1/account/deletion",
    { ...account.identity, confirmation: "delete-account" },
    { Cookie: account.Cookie }
  );
  const initial = { status: deletion.status, body: await deletion.json() };
  await server.stopServer();
  await server.stopMail();
  // These are exclusively the disposable containers owned by this runner.
  await restore("database", ordinary);
  await restore("ledger-b", ledger);
  const fixture = { Cookie: account.Cookie, trust, initial };
  await server.startServer(
    {
      PR0_LEDGER_B_URL:
        "postgres://pr0:local-deletion-test-only@localhost:1/ledger",
    },
    false
  );
  await runAcceptance(
    ["bun", "test", "apps/web/tests/account-deletion-restore.test.ts"],
    {
      PR0_DELETION_RESTORE: JSON.stringify({ ...fixture, phase: "blocked" }),
    }
  );
  await server.startServer();
  await runAcceptance(
    ["bun", "test", "apps/web/tests/account-deletion-restore.test.ts"],
    {
      PR0_DELETION_RESTORE: JSON.stringify({ ...fixture, phase: "replayed" }),
    }
  );
  server.startMail();
};
