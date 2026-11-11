import { accountTestServer, runAcceptance } from "./account-test-server";
import { verifyNativeHttps } from "./device-native";
import { verifySnapshotExpiry } from "./snapshot-expiry";

const server = accountTestServer(
  "pr0-recovery-47",
  "apps/web/tests/device-compose.yaml"
);
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/snapshots-integration.test.ts",
    "--timeout",
    "60000",
  ]);
  await verifySnapshotExpiry(server);
  await verifyNativeHttps(server, { recovery: true });
} finally {
  await server.cleanup();
}
