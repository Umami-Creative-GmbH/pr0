// oxlint-disable react-doctor/server-sequential-independent-await -- Account locks, session revalidation and proof checks deliberately serialize within one transaction.
import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import {
  accountIdentitySchema,
  reauthenticationSchema,
  emailChangeSchema,
  challengeVerificationSchema,
  accountSettingsSchema,
  linkMethodSchema,
  removeMethodSchema,
  accountErrorSchema,
} from "@pr0/api-contract/accounts";
import { verifyPassword } from "better-auth/crypto";
import type { TransactionSQL } from "bun";

import { failure, json, readBody } from "./account-http";
import {
  AccountFailureError,
  admit,
  admitEmail,
  assertOrigin,
  clientBucket,
} from "./admission";
import { authentication } from "./auth";
import {
  lockAccount,
  assertIdentity,
  proofExpiry,
  requireProof,
} from "./browser-proof";
import type { BrowserAccount, AccountState } from "./browser-proof";
import { configuration } from "./config";
import { database } from "./database";
import { listLoginMethods, removeLoginMethod } from "./login-methods";
import { enqueueAccountMail, withMailReservation } from "./mail";
import { withRequestWork } from "./request-work";

const mintProof = async (
  tx: TransactionSQL,
  browser: BrowserAccount,
  owner: AccountState
) => {
  const [proof] =
    await tx`INSERT INTO fresh_auth(session_id, instance_id, account_id, email_version, expires_at)
    VALUES (${browser.sessionId}, ${owner.instance_id}, ${browser.accountId}, ${owner.email_version}, clock_timestamp() + interval '10 minutes')
    ON CONFLICT(session_id) DO UPDATE SET email_version = EXCLUDED.email_version, expires_at = EXCLUDED.expires_at
    RETURNING expires_at`;
  return proof.expires_at.toISOString();
};

const codeDigest = (id: string, code: string) =>
  createHmac("sha256", configuration().authSecret)
    .update(`account-challenge:${id}:${code}`)
    .digest("hex");

const consumeChallenge = async (
  tx: TransactionSQL,
  browser: BrowserAccount,
  owner: AccountState,
  id: string,
  code: string,
  purpose: "reauth" | "email"
) => {
  const [challenge] =
    await tx`SELECT email, digest FROM account_challenge WHERE id = ${id}
    AND session_id = ${browser.sessionId} AND account_id = ${browser.accountId} AND instance_id = ${owner.instance_id}
    AND email_version = ${owner.email_version} AND purpose = ${purpose} AND attempts < 3 AND expires_at > clock_timestamp() FOR UPDATE`;
  if (!challenge) {
    return null;
  }
  if (
    !timingSafeEqual(
      Buffer.from(challenge.digest, "hex"),
      Buffer.from(codeDigest(id, code), "hex")
    )
  ) {
    await tx`UPDATE account_challenge SET attempts = attempts + 1 WHERE id = ${id}`;
    return null;
  }
  await tx`DELETE FROM account_challenge WHERE id = ${id}`;
  return String(challenge.email);
};

const requestChallenge = async (
  request: Request,
  browser: BrowserAccount,
  purpose: "reauth" | "email"
) => {
  const body = await readBody(request);
  const input =
    purpose === "email"
      ? emailChangeSchema.safeParse(body)
      : accountIdentitySchema.safeParse(body);
  if (!input.success) {
    throw new AccountFailureError("invalid_input", 400);
  }
  const sql = database();
  const owner = await sql.begin(async (tx) => {
    const state = await lockAccount(tx, browser);
    assertIdentity(browser, state, input.data);
    if (purpose === "email") {
      await requireProof(tx, browser, state);
    } else if (state.password) {
      throw new AccountFailureError("forbidden", 403);
    }
    return state;
  });
  const destination =
    purpose === "email" ? emailChangeSchema.parse(body).email : owner.email;
  if (purpose === "email" && destination === owner.email) {
    throw new AccountFailureError("invalid_input", 400);
  }
  await admitEmail(destination, clientBucket(request));
  return await withMailReservation((reservation) =>
    sql.begin(async (tx) => {
      const current = await lockAccount(tx, browser);
      assertIdentity(browser, current, input.data);
      if (purpose === "email") {
        await requireProof(tx, browser, current);
      } else if (current.password) {
        throw new AccountFailureError("forbidden", 403);
      }
      const id = crypto.randomUUID();
      const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
      const digest = codeDigest(id, code);
      await tx`DELETE FROM account_challenge WHERE session_id = ${browser.sessionId} AND purpose = ${purpose}`;
      const [challenge] =
        await tx`INSERT INTO account_challenge(id, session_id, instance_id, account_id, email_version, purpose, email, digest, expires_at)
      VALUES (${id}, ${browser.sessionId}, ${current.instance_id}, ${browser.accountId}, ${current.email_version}, ${purpose}, ${destination}, ${digest}, clock_timestamp() + interval '5 minutes') RETURNING expires_at`;
      const action =
        purpose === "email"
          ? "Verify your replacement pr0 email"
          : "Confirm your pr0 identity";
      await enqueueAccountMail(
        tx,
        destination,
        `${action} with this code: ${code}\n\nIt expires in five minutes. If you did not request it, ignore this email.`,
        challenge.expires_at,
        reservation,
        purpose,
        browser.accountId
      );
      return json(
        { challengeId: id, expiresAt: challenge.expires_at.toISOString() },
        202
      );
    })
  );
};

const changeEmail = async (request: Request, browser: BrowserAccount) => {
  const input = challengeVerificationSchema.safeParse(await readBody(request));
  if (!input.success) {
    throw new AccountFailureError("invalid_input", 400);
  }
  const sql = database();
  await sql.begin(async (tx) => {
    const state = await lockAccount(tx, browser);
    assertIdentity(browser, state, input.data);
    await requireProof(tx, browser, state);
  });
  return await withMailReservation((reservation) =>
    sql.begin(async (tx) => {
      const current = await lockAccount(tx, browser);
      assertIdentity(browser, current, input.data);
      await requireProof(tx, browser, current);
      const destination = await consumeChallenge(
        tx,
        browser,
        current,
        input.data.challengeId,
        input.data.code,
        "email"
      );
      if (!destination) {
        return json({ code: "invalid_challenge" }, 400);
      }
      const occupied =
        await tx`SELECT id FROM "user" WHERE email = ${destination}`;
      if (occupied.length) {
        return json({ code: "email_change_unavailable" }, 400);
      }
      // Only successful verification consumes the mandatory notice's email budget.
      await admitEmail(current.email, clientBucket(request));
      await tx`UPDATE "user" SET email = ${destination}, email_verified = true, updated_at = now() WHERE id = ${browser.accountId}`;
      await enqueueAccountMail(
        tx,
        current.email,
        `Your pr0 account email was changed to ${destination}. If you did not make this change, contact your instance operator.`,
        new Date(Date.now() + 24 * 60 * 60 * 1000),
        reservation,
        "notification",
        browser.accountId
      );
      await tx`INSERT INTO account_notice(id, account_id) VALUES (${reservation}, ${browser.accountId})`;
      return json({ status: "email_changed", notification: "pending" });
    })
  );
};

const accountSettings = async (browser: BrowserAccount) => {
  const sql = database();
  return await sql.begin(async (tx) => {
    const owner = await lockAccount(tx, browser);
    const freshUntil = await proofExpiry(tx, browser, owner);
    const [notice] =
      await tx`SELECT state FROM account_notice WHERE account_id = ${browser.accountId} ORDER BY created_at DESC, id DESC LIMIT 1`;
    return json(
      accountSettingsSchema.parse({
        accountId: browser.accountId,
        email: owner.email,
        emailVersion: owner.email_version,
        reauthentication: owner.password ? "password" : "email",
        freshUntil,
        notification: notice?.state ?? null,
      })
    );
  });
};

const reauthenticate = async (request: Request, browser: BrowserAccount) => {
  const input = reauthenticationSchema.safeParse(await readBody(request));
  if (!input.success) {
    throw new AccountFailureError("invalid_input", 400);
  }
  const { accountId, emailVersion } = input.data;
  if (accountId !== browser.accountId) {
    throw new AccountFailureError("account_changed", 409);
  }
  await admit([
    { key: `reauth:${accountId}`, max: 10, seconds: 900 },
    { key: `reauth-ip:${clientBucket(request)}`, max: 50, seconds: 900 },
  ]);
  const sql = database();
  if ("code" in input.data) {
    const { challengeId, code } = input.data;
    return await sql.begin(async (tx) => {
      const owner = await lockAccount(tx, browser);
      assertIdentity(browser, owner, input.data);
      if (
        owner.password ||
        !(await consumeChallenge(
          tx,
          browser,
          owner,
          challengeId,
          code,
          "reauth"
        ))
      ) {
        // Return instead of throwing: failed attempts must commit.
        return json({ code: "invalid_challenge" }, 400);
      }
      return json({
        status: "fresh",
        expiresAt: await mintProof(tx, browser, owner),
      });
    });
  }
  const { password } = input.data;
  const [credential] =
    await sql`SELECT password FROM account WHERE user_id = ${accountId} AND provider_id = 'credential'`;
  if (
    !credential?.password ||
    !(await verifyPassword({ hash: credential.password, password }))
  ) {
    throw new AccountFailureError("invalid_credentials", 401);
  }
  return await sql.begin(async (tx) => {
    const owner = await lockAccount(tx, browser);
    if (
      owner.email_version !== emailVersion ||
      owner.password !== credential.password
    ) {
      throw new AccountFailureError("account_changed", 409);
    }
    return json({
      status: "fresh",
      expiresAt: await mintProof(tx, browser, owner),
    });
  });
};

const startMethodLink = async (request: Request) => {
  const input = linkMethodSchema.safeParse(await readBody(request));
  if (!input.success) {
    throw new AccountFailureError("invalid_input", 400);
  }
  const response = await authentication().handler(
    new Request(`${configuration().origin}/api/auth/social/link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: configuration().origin,
        Cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify(input.data),
    })
  );
  if (!response.ok) {
    const error = accountErrorSchema.strip().safeParse(await response.json());
    return json(
      error.success ? error.data : { code: "unavailable", retryAfter: 30 },
      response.status,
      new Headers(response.headers)
    );
  }
  return response;
};

const routeAccountChange = async (
  request: Request,
  browser: BrowserAccount
) => {
  const path = new URL(request.url).pathname;
  if (path === "/api/v1/account/methods" && request.method === "GET") {
    return json(await listLoginMethods(browser));
  }
  if (request.method === "GET") {
    return accountSettings(browser);
  }
  switch (path) {
    case "/api/v1/account/methods/remove": {
      const input = removeMethodSchema.safeParse(await readBody(request));
      if (!input.success) {
        throw new AccountFailureError("invalid_input", 400);
      }
      await removeLoginMethod(input.data, browser);
      return json({ status: "ok" });
    }
    case "/api/v1/account/methods/link": {
      return startMethodLink(request);
    }
    case "/api/v1/account/reauth/challenges": {
      return requestChallenge(request, browser, "reauth");
    }
    case "/api/v1/account/email/challenges": {
      return requestChallenge(request, browser, "email");
    }
    case "/api/v1/account/email/verify": {
      return changeEmail(request, browser);
    }
    default: {
      return reauthenticate(request, browser);
    }
  }
};

export const handleAccountChange = async (request: Request) => {
  try {
    assertOrigin(request);
    return await withRequestWork(async (claimOwner) => {
      const result = await authentication().api.getSession({
        headers: new Headers({ cookie: request.headers.get("cookie") ?? "" }),
        query: { disableCookieCache: true },
        returnHeaders: true,
      });
      if (!result.response) {
        return json({ code: "unauthenticated" }, 401, result.headers);
      }
      const { user, session } = result.response;
      if (!user.emailVerified || session.provenance !== "browser") {
        return json({ code: "forbidden" }, 403, result.headers);
      }
      await claimOwner(user.id);
      await admit([{ key: `api:${user.id}`, max: 120, seconds: 60 }]);
      const browser = { accountId: user.id, sessionId: session.id };
      const response = await routeAccountChange(request, browser);
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      for (const cookie of result.headers.getSetCookie()) {
        response.headers.append("set-cookie", cookie);
      }
      return response;
    });
  } catch (error) {
    return failure(
      error instanceof Error ? error : new Error("Account change failed")
    );
  }
};
