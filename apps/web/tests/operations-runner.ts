import path from "node:path";

import { accountTestServer, runAcceptance } from "./account-test-server";
import { verifyNativeHttps } from "./device-native";

let peer: ReturnType<typeof Bun.spawn> | undefined;
const peerOrigin = "http://localhost:30461";

const server = accountTestServer(
  "pr0-operations-60",
  "apps/web/tests/operations-compose.yaml",
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
  if (process.argv.includes("native")) {
    await verifyNativeHttps(server, { live: true, operations: true });
  } else {
    peer = Bun.spawn(
      [
        "bun",
        "--bun",
        "--preload",
        path.resolve("apps/web/tests/social-provider-preload.ts"),
        "node_modules/next/dist/bin/next",
        "start",
        "--port",
        "30461",
      ],
      {
        cwd: path.resolve("apps/web"),
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
      }
    );
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Wait for the second process before cross-process assertions.
        const response = await fetch(`${peerOrigin}/api/v1/health`);
        if (response.ok) {
          break;
        }
      } catch {
        /* The second server is starting. */
      }
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Bounded process readiness.
      await Bun.sleep(100);
    }
    await runAcceptance(
      [
        "bun",
        "test",
        "apps/web/tests/operations-integration.test.ts",
        "--timeout",
        "60000",
      ],
      { PR0_TEST_PEER_ORIGIN: peerOrigin }
    );
    if (!process.argv.includes("api")) {
      await runAcceptance([
        "bun",
        "test",
        "apps/web/tests/operations-browser.test.ts",
        "--timeout",
        "90000",
      ]);
    }
  }
} finally {
  peer?.kill();
  if (peer) {
    await peer.exited;
  }
  await server.cleanup();
}
