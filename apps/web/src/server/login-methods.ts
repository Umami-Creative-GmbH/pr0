// oxlint-disable react-doctor/server-sequential-independent-await -- Identity and proof checks run under the same account lock as the mutation.
import "server-only";
import { loginMethodsSchema } from "@pr0/api-contract/accounts";
import type {
  LinkMethod,
  RemoveMethod,
  SocialProvider,
} from "@pr0/api-contract/accounts";
import { getSessionFromCtx } from "better-auth/api";
import type { handleOAuthUserInfo } from "better-auth/oauth2";
import { z } from "zod";

import { AccountFailureError } from "./admission";
import { assertIdentity, lockAccount, requireProof } from "./browser-proof";
import type { BrowserAccount } from "./browser-proof";
import { database } from "./database";
import { enabledProviders } from "./social-config";

type SocialContext = Parameters<typeof handleOAuthUserInfo>[0];
export const linkStateSchema = z.strictObject({
  accountId: z.uuid(),
  sessionId: z.uuid(),
  instanceId: z.uuid(),
  emailVersion: z.number().int().nonnegative(),
});

const browserFor = async (ctx: SocialContext) => {
  const result = await getSessionFromCtx(ctx, { disableCookieCache: true });
  if (!result?.user.emailVerified) {
    throw new AccountFailureError("unauthenticated", 401);
  }
  return { accountId: result.user.id, sessionId: result.session.id };
};

export const beginMethodLink = async (
  ctx: SocialContext,
  input: LinkMethod
) => {
  const browser = await browserFor(ctx);
  return await database().begin(async (tx) => {
    const owner = await lockAccount(tx, browser);
    assertIdentity(browser, owner, input);
    await requireProof(tx, browser, owner);
    return {
      ...browser,
      instanceId: owner.instance_id,
      emailVersion: owner.email_version,
    };
  });
};

export const finishMethodLink = async (
  ctx: SocialContext,
  expected: z.infer<typeof linkStateSchema>,
  provider: SocialProvider,
  subject: string
) => {
  const browser = await browserFor(ctx);
  if (
    browser.accountId !== expected.accountId ||
    browser.sessionId !== expected.sessionId
  ) {
    throw new AccountFailureError("account_changed", 409);
  }
  await database().begin(async (tx) => {
    const owner = await lockAccount(tx, browser);
    assertIdentity(browser, owner, expected);
    if (owner.instance_id !== expected.instanceId) {
      throw new AccountFailureError("account_changed", 409);
    }
    await requireProof(tx, browser, owner);
    const existing =
      await tx`SELECT account_id FROM account WHERE user_id = ${browser.accountId} AND provider_id = ${provider}`;
    if (
      existing.some(
        (method: { account_id: string }) => method.account_id !== subject
      )
    ) {
      throw new AccountFailureError("method_already_linked", 409);
    }
    // The provider/subject unique constraint arbitrates competing accounts atomically.
    await tx`INSERT INTO account(id, account_id, provider_id, user_id, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${subject}, ${provider}, ${browser.accountId}, now(), now())
      ON CONFLICT(provider_id, account_id) DO NOTHING`;
    const [linked] =
      await tx`SELECT user_id FROM account WHERE provider_id = ${provider} AND account_id = ${subject}`;
    if (linked?.user_id !== browser.accountId) {
      throw new AccountFailureError("provider_owned", 409);
    }
    await requireProof(tx, browser, owner);
  });
};

export const listLoginMethods = async (browser: BrowserAccount) => {
  const providers = enabledProviders();
  return await database().begin(async (tx) => {
    await lockAccount(tx, browser);
    const methods = await tx`SELECT id, provider_id AS provider,
      CASE WHEN provider_id = 'credential' THEN password IS NOT NULL AND password <> ''
      ELSE provider_id = ANY(${tx.array(providers, "TEXT")}) END AS usable
      FROM account WHERE user_id = ${browser.accountId} ORDER BY provider_id, id`;
    return loginMethodsSchema.parse({
      accountId: browser.accountId,
      methods,
      providers,
    });
  });
};

export const removeLoginMethod = async (
  input: RemoveMethod,
  browser: BrowserAccount
) => {
  const providers = enabledProviders();
  return await database().begin(async (tx) => {
    const owner = await lockAccount(tx, browser);
    assertIdentity(browser, owner, input);
    await requireProof(tx, browser, owner);
    const methods =
      await tx`SELECT id FROM account WHERE user_id = ${browser.accountId} AND id = ${input.methodId}`;
    if (!methods.length) {
      throw new AccountFailureError("not_found", 404);
    }
    const remaining =
      await tx`SELECT id FROM account WHERE user_id = ${browser.accountId} AND id <> ${input.methodId}
      AND ((provider_id = 'credential' AND password IS NOT NULL AND password <> '') OR provider_id = ANY(${tx.array(providers, "TEXT")}))`;
    if (!remaining.length) {
      throw new AccountFailureError("last_login_method", 409);
    }
    await tx`DELETE FROM account WHERE id = ${input.methodId} AND user_id = ${browser.accountId}`;
    // Reject sessions still being issued against a removed credential.
    await tx`UPDATE "user" SET authentication_version = authentication_version + 1 WHERE id = ${browser.accountId}`;
    await requireProof(tx, browser, owner);
  });
};
