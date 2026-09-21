import { accountTestServer, runAcceptance } from "./account-test-server";

const server = accountTestServer(
  "pr0-transitions-48",
  "apps/web/tests/device-compose.yaml",
  () =>
    runAcceptance([
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/deletions.ts",
      "initialize",
    ])
);
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/device-integration.test.ts",
    "apps/web/tests/recovery-integration.test.ts",
    "--timeout",
    "60000",
  ]);
} finally {
  await server.cleanup();
}
