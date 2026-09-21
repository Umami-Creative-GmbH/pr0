import assert from "node:assert/strict";

import { SQL } from "bun";

import { accountTestServer, runAcceptance } from "./account-test-server";
import { origin } from "./http-fixture";
import { verifyServerUpgrade } from "./migration-journey";

const server = accountTestServer(
  "pr0-compatibility-58",
  "apps/web/tests/compatibility-compose.yaml",
  () =>
    runAcceptance([
      "bun",
      "--conditions=react-server",
      "apps/web/scripts/deletions.ts",
      "initialize",
    ])
);
const sql = new SQL(process.env.DATABASE_URL ?? "");
try {
  await server.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/compatibility-integration.test.ts",
  ]);
  // Storage setup simulates a terminated coordinator. Admission is observed at REST.
  await sql`UPDATE migration_control SET phase='migrating' WHERE singleton=1`;
  const stopped = await fetch(`${origin}/api/v1/capabilities`);
  assert.equal(
    stopped.status,
    503,
    "interrupted migration must close request admission"
  );
  const unready = await fetch(`${origin}/api/v1/ready`);
  assert.equal(unready.status, 503);
  await runAcceptance([
    "bun",
    "--conditions=react-server",
    "apps/web/scripts/accounts.ts",
    "migrate",
  ]);
  const recovered = await fetch(`${origin}/api/v1/capabilities`);
  assert.equal(recovered.status, 200);
  await verifyServerUpgrade(sql, server);
} finally {
  await sql.close();
  await server.cleanup();
}
