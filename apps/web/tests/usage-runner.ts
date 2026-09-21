import { accountTestServer, runAcceptance } from "./account-test-server";
import { verifyNativeHttps } from "./device-native";

const server = accountTestServer(
  "pr0-usage-49",
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
    "apps/web/tests/prompt-use-integration.test.ts",
    "--timeout",
    "60000",
  ]);
  await verifyNativeHttps(server, false, false, true);
} finally {
  await server.cleanup();
}
