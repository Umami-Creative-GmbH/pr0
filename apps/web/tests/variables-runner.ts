import { accountTestServer, runAcceptance } from "./account-test-server";

const server = accountTestServer("pr0-variables-52");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/variables-browser.test.ts",
    "apps/web/tests/prompt-copy-browser.test.ts",
    "apps/web/tests/prompt-copy-webkit.test.ts",
    "--timeout",
    "120000",
    ...process.argv.slice(2),
  ]);
} finally {
  await server.cleanup();
}
