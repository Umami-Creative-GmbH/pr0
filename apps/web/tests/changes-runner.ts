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
  const selected = process.argv.at(2);
  await server.setup();
  await runAcceptance(["bun", "apps/web/tests/changes-notification-fault.ts"]);
  await server.startServer();
  if (!selected || selected === "http") {
    await runAcceptance([
      "bun",
      "test",
      "apps/web/tests/changes-integration.test.ts",
      "--timeout",
      "60000",
    ]);
  }
  if (!selected || selected === "browser") {
    await runAcceptance([
      "bun",
      "test",
      "apps/web/tests/changes-browser.test.ts",
      "--rerun-each=3",
      "--timeout",
      "60000",
    ]);
  }
  if (!selected || selected === "native") {
    await verifyNativeHttps(server, false, false, false, true);
  }
} catch (error) {
  await runAcceptance([
    "docker",
    "compose",
    "-p",
    "pr0-live-43",
    "-f",
    "apps/web/tests/changes-compose.yaml",
    "logs",
    "database",
  ]);
  throw error;
} finally {
  await server.cleanup();
}
