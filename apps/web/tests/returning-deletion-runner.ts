import { accountTestServer } from "./account-test-server";
import { verifyNativeHttps } from "./device-native";
import { verifyReturningDeletion } from "./returning-deletion-native";

const server = accountTestServer(
  "pr0-returning-57",
  "apps/web/tests/account-deletion-compose.yaml"
);
const desktop = Bun.spawn(["bun", "run", "--cwd", "apps/desktop", "dev"], {
  stdout: "inherit",
  stderr: "inherit",
});
try {
  await server.setup();
  await verifyNativeHttps(server, { afterSession: verifyReturningDeletion });
} finally {
  desktop.kill();
  await desktop.exited;
  await server.cleanup();
}
