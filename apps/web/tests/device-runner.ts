import { accountTestServer, runAcceptance } from "./account-test-server";
import { verifyNativeHttps } from "./device-native";
import { verifyDeviceRestart } from "./device-restart";

const server = accountTestServer(
  "pr0-device-39",
  "apps/web/tests/device-compose.yaml"
);
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/device-integration.test.ts",
    "apps/web/tests/device-browser.test.ts",
    "--timeout",
    "60000",
  ]);
  await verifyDeviceRestart(server);
  await server.startServer();
  await verifyNativeHttps(server);
} finally {
  await server.cleanup();
}
