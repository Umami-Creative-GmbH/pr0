// oxlint-disable react-doctor/server-sequential-independent-await -- Lock the account before its session to serialize with recovery and email changes.
import "server-only";
import type { accountIdentitySchema } from "@pr0/api-contract/accounts";
import type { TransactionSQL } from "bun";
import type { z } from "zod";

import { AccountFailureError } from "./admission";

export interface BrowserAccount {
  accountId: string;
  sessionId: string;
  provenance?: "device";
}
export interface AccountState {
  email: string;
  email_version: number;
  instance_id: string;
  password: string | null;
}

export const lockAccount = async (
  tx: TransactionSQL,
  browser: BrowserAccount
) => {
  const [owner] = await tx<
    AccountState[]
  >`SELECT u.email, u.email_version, i.id AS instance_id,
    (SELECT password FROM account WHERE user_id = u.id AND provider_id = 'credential' LIMIT 1) AS password
    FROM "user" u CROSS JOIN instance i WHERE u.id = ${browser.accountId} AND u.email_verified AND NOT u.deletion_pending FOR UPDATE OF u`;
  const active =
    await tx`SELECT id FROM session WHERE id = ${browser.sessionId} AND user_id = ${browser.accountId}
    AND provenance = ${browser.provenance ?? "browser"} AND expires_at > clock_timestamp() FOR UPDATE`;
  if (!owner || !active.length) {
    throw new AccountFailureError("unauthenticated", 401);
  }
  return owner;
};

export const assertIdentity = (
  browser: BrowserAccount,
  owner: AccountState,
  input: z.infer<typeof accountIdentitySchema>
) => {
  if (
    browser.accountId !== input.accountId ||
    owner.email_version !== input.emailVersion
  ) {
    throw new AccountFailureError("account_changed", 409);
  }
};

export const proofExpiry = async (
  tx: TransactionSQL,
  browser: BrowserAccount,
  owner: AccountState
) => {
  const [proof] =
    await tx`SELECT expires_at FROM fresh_auth WHERE session_id = ${browser.sessionId}
    AND account_id = ${browser.accountId} AND instance_id = ${owner.instance_id} AND email_version = ${owner.email_version}
    AND expires_at > clock_timestamp()`;
  return proof?.expires_at?.toISOString() ?? null;
};

export const requireProof = async (
  tx: TransactionSQL,
  browser: BrowserAccount,
  owner: AccountState
) => {
  if (!(await proofExpiry(tx, browser, owner))) {
    throw new AccountFailureError("fresh_auth_required", 403);
  }
};
