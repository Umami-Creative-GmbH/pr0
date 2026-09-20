import type { LibraryScope } from "@pr0/api-contract/prompts";
import { SQL } from "bun";

// Seed pre-existing usage at the external database boundary; observe retention through REST.
export const seedPromptUsage = async (scope: LibraryScope, id: string) => {
  const url = process.env.DATABASE_URL;
  if (url !== "postgres://pr0:local-social-test-only@localhost:55426/pr0") {
    throw new Error("Usage fixture requires the isolated local test database");
  }
  const sql = new SQL(url);
  try {
    await sql`UPDATE prompt SET use_count = 7, last_used_at = '2026-09-19T12:00:00.000Z' WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} AND id = ${id}`;
  } finally {
    await sql.close();
  }
};
