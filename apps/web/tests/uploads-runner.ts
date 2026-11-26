import { accountTestServer, runAcceptance } from "./account-test-server";
import { verifyNativeHttps } from "./device-native";

const server = accountTestServer(
  "pr0-uploads-42",
  "apps/web/tests/device-compose.yaml"
);
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/uploads-integration.test.ts",
    "--timeout",
    "60000",
  ]);
  await verifyNativeHttps(server, { upload: true });
} finally {
  await server.cleanup();
}
