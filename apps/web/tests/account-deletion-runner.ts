import { deletionRestartScenarios } from "./account-deletion-restart";
import { accountTestServer, runAcceptance } from "./account-test-server";

const fixture = accountTestServer(
  "pr0-deletion-56",
  "apps/web/tests/account-deletion-compose.yaml",
  () =>
    runAcceptance([
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/deletions.ts",
      "initialize",
    ])
);
try {
  await fixture.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/account-deletion-integration.test.ts",
    "--timeout",
    "30000",
  ]);
  await deletionRestartScenarios(fixture);
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/account-deletion-browser.test.ts",
    "--timeout",
    "30000",
  ]);
  for (const file of [
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
} finally {
  await fixture.cleanup();
}
