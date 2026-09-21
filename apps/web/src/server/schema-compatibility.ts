import "server-only";
import type { SQL, TransactionSQL } from "bun";

import { AccountFailureError } from "./admission";
import { database } from "./database";

export const serverMigrationVersion = 20;
export const ensureSchemaCompatibility = async (
  sql: SQL | TransactionSQL = database()
) => {
  const [state] =
    await sql`SELECT c.phase,c.completed,i.minimum_server_migration AS minimum,(SELECT max(version) FROM migration) AS actual FROM migration_control c CROSS JOIN instance i WHERE c.singleton=1`;
  if (
    state?.phase !== "ready" ||
    state.completed < serverMigrationVersion ||
    state.actual !== state.completed ||
    state.minimum > serverMigrationVersion
  ) {
    throw new AccountFailureError("unavailable", 503, 30);
  }
};
