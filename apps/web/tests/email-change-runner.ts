import { accountTestServer, runAcceptance } from "./account-test-server";

const fixture = accountTestServer("pr0-email-27");
try {
  await fixture.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/email-change-integration.test.ts",
    "--timeout",
    "20000",
  ]);
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/email-notification-integration.test.ts",
    "--timeout",
    "40000",
  ]);
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/recovery-integration.test.ts",
    "--timeout",
    "30000",
  ]);
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/accounts-integration.test.ts",
    "--timeout",
    "30000",
  ]);
} finally {
  await fixture.cleanup();
}
