import { accountTestServer, runAcceptance } from "./account-test-server";
import { verifyNativeHttps } from "./device-native";

const server = accountTestServer(
  "pr0-lifecycle-44",
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
  if (process.argv.at(2) !== "native") {
    await runAcceptance([
      "bun",
      "test",
      "apps/web/tests/prompt-deletion-integration.test.ts",
      "apps/web/tests/prompt-lifecycle-integration.test.ts",
      "--timeout",
      "60000",
    ]);
  }
  await verifyNativeHttps(server, { lifecycle: true });
} finally {
  await server.cleanup();
}
