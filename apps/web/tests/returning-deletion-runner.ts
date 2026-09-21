import { accountTestServer, runAcceptance } from "./account-test-server";
import { verifyNativeHttps } from "./device-native";
import { verifyReturningDeletion } from "./returning-deletion-native";

const server = accountTestServer(
  "pr0-returning-57",
  "apps/web/tests/account-deletion-compose.yaml",
  () =>
    runAcceptance([
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/deletions.ts",
      "initialize",
    ])
);
const desktop = Bun.spawn(["bun", "run", "--cwd", "apps/desktop", "dev"], {
  stdout: "inherit",
  stderr: "inherit",
});
try {
  await server.setup();
  await verifyNativeHttps(
    server,
    false,
    false,
    false,
    false,
    verifyReturningDeletion
  );
} finally {
  desktop.kill();
  await desktop.exited;
  await server.cleanup();
}
