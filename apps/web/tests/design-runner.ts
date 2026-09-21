import { accountTestServer, runAcceptance } from "./account-test-server";

const server = accountTestServer("pr0-design-75");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/design-browser.test.ts",
    "--timeout",
    "180000",
    ...process.argv.slice(2),
  ]);
} finally {
  await server.cleanup();
}
