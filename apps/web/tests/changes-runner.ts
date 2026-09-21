import { accountTestServer, runAcceptance } from "./account-test-server";
import { verifyNativeHttps } from "./device-native";

const server = accountTestServer(
  "pr0-live-43",
  "apps/web/tests/changes-compose.yaml",
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
  await runAcceptance(["bun", "apps/web/tests/changes-notification-fault.ts"]);
  await server.startServer();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/changes-integration.test.ts",
    "--timeout",
    "60000",
  ]);
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/changes-browser.test.ts",
    "--timeout",
    "60000",
  ]);
  await verifyNativeHttps(server, false, false, true);
} finally {
  await server.cleanup();
}
