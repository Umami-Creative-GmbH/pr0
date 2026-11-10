// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Reproduce each reserved-transaction lifetime independently.
import assert from "node:assert/strict";

import { SQL } from "bun";

const url = process.env.DIAGNOSTIC_DATABASE_URL;
assert.ok(
  url,
  "Set DIAGNOSTIC_DATABASE_URL to a disposable PostgreSQL database"
);
const samples: { mode: string; passed: boolean; error?: string }[] = [];
for (const mode of ["async", "cpu"]) {
  const sql = new SQL(url, { max: 2, idleTimeout: 1, connectionTimeout: 3 });
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT 1`;
      const started = performance.now();
      if (mode === "async") {
        await Bun.sleep(2000);
      } else {
        while (performance.now() - started < 2000) {
          // Deliberately block the event loop, matching synchronous SQLite indexing.
        }
      }
      await tx`SELECT 2`;
    });
    samples.push({ mode, passed: true });
  } catch (error) {
    samples.push({ mode, passed: false, error: String(error) });
  } finally {
    await sql.close();
  }
}
process.stdout.write(
  `${JSON.stringify({ bun: Bun.version, platform: process.platform, samples })}\n`
);
if (samples.some((sample) => !sample.passed)) {
  process.exitCode = 1;
}
