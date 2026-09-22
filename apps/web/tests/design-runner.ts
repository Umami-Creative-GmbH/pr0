import { accountTestServer, runAcceptance } from "./account-test-server";

// `bun run test:design` runs the design journey. Pass test files to reuse the
// same served build for other browser journeys affected by presentation work:
// `bun run test:design apps/web/tests/prompts-browser.test.ts …`
const requested = process.argv.slice(2);
const files = requested.filter((value) => value.endsWith(".test.ts"));
const options = requested.filter((value) => !value.endsWith(".test.ts"));

const server = accountTestServer("pr0-design-75");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    ...(files.length ? files : ["apps/web/tests/design-browser.test.ts"]),
    "--timeout",
    "180000",
    ...options,
  ]);
} finally {
  await server.cleanup();
}
