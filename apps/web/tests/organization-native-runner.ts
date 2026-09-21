import { accountTestServer, runAcceptance } from "./account-test-server";
import { verifyNativeHttps } from "./device-native";

const server = accountTestServer(
  "pr0-organization-45",
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
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/organization-cleanup-integration.test.ts",
    "--timeout",
    "60000",
  ]);
  await verifyNativeHttps(server, false, false, false, "organization");
} finally {
  await server.cleanup();
}
