import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { deletionRestartScenarios } from "./account-deletion-restart";
import { deletionRestoreScenario } from "./account-deletion-restore";
import { accountTestServer, runAcceptance } from "./account-test-server";

// The durable deletion log for this run; the served app and every child read it.
const deletionLog = path.resolve(
  import.meta.dir,
  `../.data/deletion-log-56-${crypto.randomUUID()}`
);
mkdirSync(deletionLog, { recursive: true });
process.env.PR0_DELETION_LOG_DIRECTORY = deletionLog;
const fixture = accountTestServer(
  "pr0-deletion-56",
  "apps/web/tests/account-deletion-compose.yaml"
);
try {
  await fixture.setup();
  if (process.argv.includes("--restore-only")) {
    await deletionRestoreScenario(fixture);
  } else {
    if (!process.argv.includes("--browser-only")) {
      await runAcceptance([
        "bun",
        "test",
        "apps/web/tests/account-deletion-integration.test.ts",
        "--timeout",
        "30000",
      ]);
      await deletionRestartScenarios(fixture);
      await deletionRestoreScenario(fixture);
    }
    await runAcceptance([
      "bun",
      "test",
      "apps/web/tests/account-deletion-browser.test.ts",
      "--timeout",
      "30000",
    ]);
    for (const file of process.argv.includes("--browser-only")
      ? []
      : [
          "email-change",
          "login-methods",
          "prompts",
          "prompt-deletion",
          "organization-cleanup",
          "accounts",
        ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- The anonymous-admission saturation scenario runs last, after other account flows.
      await runAcceptance([
        "bun",
        "test",
        `apps/web/tests/${file}-integration.test.ts`,
        "--timeout",
        "60000",
      ]);
    }
  }
} finally {
  await fixture.cleanup();
  rmSync(deletionLog, { recursive: true, force: true });
}
