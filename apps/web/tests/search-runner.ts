import { accountTestServer, runAcceptance } from "./account-test-server";
import { verifySearchRecovery } from "./search-recovery";

const server = accountTestServer("pr0-search-36");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    ...(process.argv.slice(2).length
      ? process.argv.slice(2)
      : [
          "apps/web/tests/search-integration.test.ts",
          "apps/web/tests/search-browser.test.ts",
          "apps/web/tests/search-capacity.test.ts",
        ]),
    "--timeout",
    "120000",
  ]);
  if (!process.argv.slice(2).length) {
    await verifySearchRecovery(server);
  }
} finally {
  await server.cleanup();
}
