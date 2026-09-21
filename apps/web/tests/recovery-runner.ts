import { accountTestServer, runAcceptance } from "./account-test-server";
import { verifyNativeHttps } from "./device-native";
import { verifySnapshotExpiry } from "./snapshot-expiry";

const server = accountTestServer(
  "pr0-recovery-47",
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
    "apps/web/tests/snapshots-integration.test.ts",
    "--timeout",
    "60000",
  ]);
  await verifySnapshotExpiry(server);
  await verifyNativeHttps(server, false, false, false, false, true);
} finally {
  await server.cleanup();
}
