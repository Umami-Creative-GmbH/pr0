import { accountTestServer, runAcceptance } from "./account-test-server";

const server = accountTestServer("pr0-session-race-96");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/session-race-browser.test.ts",
    "apps/web/tests/session-renewal-integration.test.ts",
    "--timeout",
    "60000",
  ]);
} finally {
  await server.cleanup();
}
