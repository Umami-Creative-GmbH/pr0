import "server-only";
import type { SQL, TransactionSQL } from "bun";

import { AccountFailureError } from "./admission";
import { secret } from "./config";
import { database } from "./database";
import { assertRestoreAdmission, readRestoreState } from "./restore-state";

export const serverMigrationVersion = 20;
export const ensureSchemaCompatibility = async (
  sql: SQL | TransactionSQL = database(),
  recoveryCheck = false
) => {
  if (!recoveryCheck) {
    try {
      assertRestoreAdmission();
    } catch {
      throw new AccountFailureError("unavailable", 503, 30);
    }
  }
  const [state] =
    await sql`SELECT c.phase,c.completed,i.id,i.recovery_epoch,i.minimum_server_migration AS minimum,(SELECT max(version) FROM migration) AS actual FROM migration_control c CROSS JOIN instance i WHERE c.singleton=1`;
  const recovery = recoveryCheck ? null : readRestoreState();
  if (
    (recovery &&
      (recovery.instanceId !== state?.id ||
        recovery.epoch !== state.recovery_epoch ||
        recovery.authDigest !==
          new Bun.CryptoHasher("sha256")
            .update(secret("BETTER_AUTH_SECRET"))
            .digest("hex"))) ||
    state?.phase !== "ready" ||
    state.completed < serverMigrationVersion ||
    state.actual !== state.completed ||
    state.minimum > serverMigrationVersion
  ) {
    throw new AccountFailureError("unavailable", 503, 30);
  }
};
