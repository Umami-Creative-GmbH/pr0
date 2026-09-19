import "server-only";
import type { PasswordReset } from "@pr0/api-contract/accounts";
import { hashPassword } from "better-auth/crypto";

import { AccountFailureError } from "./admission";
import { database } from "./database";

export const resetPassword = async ({ token, newPassword }: PasswordReset) => {
  const sql = database();
  const identifier = `reset-password:${token}`;
  // Hash outside the transaction so account locks never cover expensive work.
  const password = await hashPassword(newPassword);
  await sql.begin(async (tx) => {
    const [owner] =
      await tx`SELECT u.id FROM "user" u JOIN verification v ON v.value = u.id
      WHERE v.identifier = ${identifier} AND v.expires_at > clock_timestamp() AND u.email_verified
      FOR UPDATE OF u`;
    if (!owner) {
      throw new AccountFailureError("invalid_recovery", 400);
    }
    // Recheck after the owner lock: concurrent resets must consume a token only once.
    const consumed =
      await tx`DELETE FROM verification WHERE identifier = ${identifier}
      AND value = ${owner.id} AND expires_at > clock_timestamp() RETURNING id`;
    if (!consumed.length) {
      throw new AccountFailureError("invalid_recovery", 400);
    }
    await tx`UPDATE "user" SET authentication_version = authentication_version + 1 WHERE id = ${owner.id}`;
    const updated =
      await tx`UPDATE account SET password = ${password}, updated_at = now()
      WHERE user_id = ${owner.id} AND provider_id = 'credential' RETURNING id`;
    if (!updated.length) {
      await tx`INSERT INTO account(id, account_id, provider_id, user_id, password, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${owner.id}, 'credential', ${owner.id}, ${password}, now(), now())`;
    }
    await tx`DELETE FROM session WHERE user_id = ${owner.id}`;
    await tx`DELETE FROM verification WHERE value = ${owner.id} AND identifier LIKE 'reset-password:%'`;
  });
};
