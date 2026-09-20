// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Ordered public security scenarios and bounded SMTP polling.
import { expect, test, afterAll } from "bun:test";
import { createHmac } from "node:crypto";

import { SQL } from "bun";

import {
  emailCode,
  socialBrowser,
  freshSocialBrowser,
} from "./email-change-fixture";
import {
  cookieFrom,
  password,
  post,
  accountEmailLink,
  origin,
} from "./http-fixture";
import { githubLogin, libraryFor } from "./social-fixture";

// SQL only controls clock/provenance fixtures; assertions observe public HTTP.
const sql = new SQL(process.env.DATABASE_URL ?? "");
afterAll(async () => {
  await sql.close();
});

const assertCode = async (response: Response, status: number, code: string) => {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ code });
};

test("the public signup-verification route refuses signed Better Auth email-change tokens", async () => {
  const browser = await socialBrowser();
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      email: browser.email,
      updateTo: "direct-change@example.test",
      requestType: "change-email-verification",
      exp: Math.floor(Date.now() / 1000) + 60,
    })
  ).toString("base64url");
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
    .update(`${header}.${payload}`)
    .digest("base64url");
  const response = await fetch(
    `${origin}/api/auth/verify-email?token=${header}.${payload}.${signature}`,
    { headers: { Cookie: browser.Cookie }, redirect: "manual" }
  );
  expect(response.headers.get("location")).toBe(
    `${origin}/?verification=invalid`
  );
  const library = await libraryFor(browser.Cookie);
  expect(library.account.email).toBe(browser.email);
});

test("wrong password and stale identity cannot grant freshness", async () => {
  const email = `${crypto.randomUUID()}@example.test`;
  await post("/api/auth/sign-up/email", { email, password });
  await fetch(await accountEmailLink(email), { redirect: "manual" });
  const Cookie = cookieFrom(
    await post("/api/auth/sign-in/email", { email, password })
  );
  const library = await libraryFor(Cookie);
  const identity = { accountId: library.account.id, emailVersion: 0 };
  await assertCode(
    await post(
      "/api/v1/account/reauth/verify",
      { ...identity, password: "incorrect-long-password" },
      { Cookie }
    ),
    401,
    "invalid_credentials"
  );
  await assertCode(
    await post(
      "/api/v1/account/reauth/verify",
      { ...identity, emailVersion: 1, password },
      { Cookie }
    ),
    409,
    "account_changed"
  );
  await assertCode(
    await post(
      "/api/v1/account/email/challenges",
      { ...identity, email: "new@example.test" },
      { Cookie }
    ),
    403,
    "fresh_auth_required"
  );
});

test("replacement codes expire and exhaust after three wrong attempts without changing the address", async () => {
  const browser = await freshSocialBrowser();
  const headers = { Cookie: browser.Cookie };
  const email = `${crypto.randomUUID()}@example.test`;
  const response = await post(
    "/api/v1/account/email/challenges",
    { ...browser.identity, email },
    headers
  );
  const challenge = await response.json();
  const code = await emailCode(email);
  const input = {
    ...browser.identity,
    challengeId: challenge.challengeId,
    code,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assertCode(
      await post(
        "/api/v1/account/email/verify",
        { ...input, code: code === "00000000" ? "11111111" : "00000000" },
        headers
      ),
      400,
      "invalid_challenge"
    );
  }
  await assertCode(
    await post("/api/v1/account/email/verify", input, headers),
    400,
    "invalid_challenge"
  );
  const resend = await post(
    "/api/v1/account/email/challenges",
    { ...browser.identity, email },
    headers
  );
  const replacement = await resend.json();
  const replacementCode = await emailCode(email, [code]);
  await sql`UPDATE account_challenge SET expires_at = clock_timestamp() - interval '1 second' WHERE id = ${replacement.challengeId}`;
  await assertCode(
    await post(
      "/api/v1/account/email/verify",
      {
        ...browser.identity,
        challengeId: replacement.challengeId,
        code: replacementCode,
      },
      headers
    ),
    400,
    "invalid_challenge"
  );
  const unchanged = await libraryFor(browser.Cookie);
  expect(unchanged.account.email).toBe(browser.email);
});

test("another account's email cannot replace or merge the caller's account", async () => {
  const other = await socialBrowser();
  const browser = await freshSocialBrowser();
  const headers = { Cookie: browser.Cookie };
  const response = await post(
    "/api/v1/account/email/challenges",
    { ...browser.identity, email: other.email },
    headers
  );
  const { challengeId } = await response.json();
  await assertCode(
    await post(
      "/api/v1/account/email/verify",
      { ...browser.identity, challengeId, code: await emailCode(other.email) },
      headers
    ),
    400,
    "email_change_unavailable"
  );
  const caller = await libraryFor(browser.Cookie);
  const owner = await libraryFor(other.Cookie);
  expect(caller.account.email).toBe(browser.email);
  expect(owner.account.id).toBe(other.identity.accountId);
});

test("revoking a browser invalidates its pending challenge and proof", async () => {
  const browser = await freshSocialBrowser();
  const headers = { Cookie: browser.Cookie };
  const email = `${crypto.randomUUID()}@example.test`;
  const response = await post(
    "/api/v1/account/email/challenges",
    { ...browser.identity, email },
    headers
  );
  const { challengeId } = await response.json();
  const code = await emailCode(email);
  const other = cookieFrom(await githubLogin(browser.subject, browser.email));
  const revoked = await post(
    "/api/v1/sessions/revoke",
    { sessionId: browser.sessionId },
    { Cookie: other }
  );
  expect(revoked.status).toBe(200);
  await assertCode(
    await post(
      "/api/v1/account/email/verify",
      { ...browser.identity, challengeId, code },
      headers
    ),
    401,
    "unauthenticated"
  );
  const retained = await libraryFor(other);
  expect(retained.account.email).toBe(browser.email);
});

test("password re-entry grants freshness only to the initiating browser account", async () => {
  const email = `${crypto.randomUUID()}@example.test`;
  await post("/api/auth/sign-up/email", { email, password });
  await fetch(await accountEmailLink(email), { redirect: "manual" });
  const login = await post("/api/auth/sign-in/email", { email, password });
  const Cookie = cookieFrom(login);
  const library = await libraryFor(Cookie);
  const identity = { accountId: library.account.id, emailVersion: 0 };
  const response = await post(
    "/api/v1/account/reauth/verify",
    { ...identity, password },
    { Cookie }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "fresh" });
  const other = cookieFrom(
    await post("/api/auth/sign-in/email", { email, password })
  );
  await assertCode(
    await post(
      "/api/v1/account/email/challenges",
      { ...identity, email: "replacement@example.test" },
      { Cookie: other }
    ),
    403,
    "fresh_auth_required"
  );
  await assertCode(
    await post("/api/v1/account/reauth/challenges", identity, { Cookie }),
    403,
    "forbidden"
  );
});

test("resending invalidates the old code, three wrong attempts exhaust the new code, and races consume once", async () => {
  const browser = await socialBrowser();
  const headers = { Cookie: browser.Cookie };
  const first = await post(
    "/api/v1/account/reauth/challenges",
    browser.identity,
    headers
  );
  const firstChallenge = await first.json();
  const firstCode = await emailCode(browser.email);
  const second = await post(
    "/api/v1/account/reauth/challenges",
    browser.identity,
    headers
  );
  const secondChallenge = await second.json();
  const secondCode = await emailCode(browser.email, [firstCode]);
  await assertCode(
    await post(
      "/api/v1/account/reauth/verify",
      {
        ...browser.identity,
        challengeId: firstChallenge.challengeId,
        code: firstCode,
      },
      headers
    ),
    400,
    "invalid_challenge"
  );
  const wrong = secondCode === "00000000" ? "11111111" : "00000000";
  const failures = await Promise.all(
    Array.from({ length: 3 }, () =>
      post(
        "/api/v1/account/reauth/verify",
        {
          ...browser.identity,
          challengeId: secondChallenge.challengeId,
          code: wrong,
        },
        headers
      )
    )
  );
  for (const failure of failures) {
    await assertCode(failure, 400, "invalid_challenge");
  }
  await assertCode(
    await post(
      "/api/v1/account/reauth/verify",
      {
        ...browser.identity,
        challengeId: secondChallenge.challengeId,
        code: secondCode,
      },
      headers
    ),
    400,
    "invalid_challenge"
  );
  const third = await post(
    "/api/v1/account/reauth/challenges",
    browser.identity,
    headers
  );
  const thirdChallenge = await third.json();
  const thirdCode = await emailCode(browser.email, [firstCode, secondCode]);
  const outcomes = await Promise.all(
    Array.from({ length: 2 }, () =>
      post(
        "/api/v1/account/reauth/verify",
        {
          ...browser.identity,
          challengeId: thirdChallenge.challengeId,
          code: thirdCode,
        },
        headers
      )
    )
  );
  expect(new Set(outcomes.map((result) => result.status))).toEqual(
    new Set([200, 400])
  );
  const limited = await post(
    "/api/v1/account/reauth/challenges",
    browser.identity,
    headers
  );
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).not.toBeNull();
});

test("expired codes, changed accounts and another browser cannot create a proof", async () => {
  const browser = await socialBrowser();
  const request = await post(
    "/api/v1/account/reauth/challenges",
    browser.identity,
    { Cookie: browser.Cookie }
  );
  const challenge = await request.json();
  const input = {
    ...browser.identity,
    challengeId: challenge.challengeId,
    code: await emailCode(browser.email),
  };
  const secondCookie = cookieFrom(
    await githubLogin(browser.subject, browser.email)
  );
  await assertCode(
    await post("/api/v1/account/reauth/verify", input, {
      Cookie: secondCookie,
    }),
    400,
    "invalid_challenge"
  );
  const other = await socialBrowser();
  await assertCode(
    await post("/api/v1/account/reauth/verify", input, {
      Cookie: other.Cookie,
    }),
    409,
    "account_changed"
  );
  await sql`UPDATE account_challenge SET expires_at = clock_timestamp() - interval '1 second' WHERE id = ${challenge.challengeId}`;
  await assertCode(
    await post("/api/v1/account/reauth/verify", input, {
      Cookie: browser.Cookie,
    }),
    400,
    "invalid_challenge"
  );
});

test("renewal cannot restore expired freshness and email verification preserves the old address", async () => {
  const browser = await freshSocialBrowser();
  const headers = { Cookie: browser.Cookie };
  const email = `${crypto.randomUUID()}@example.test`;
  const response = await post(
    "/api/v1/account/email/challenges",
    { ...browser.identity, email },
    headers
  );
  const challenge = await response.json();
  const code = await emailCode(email);
  await sql`UPDATE fresh_auth SET expires_at = clock_timestamp() - interval '1 second' WHERE session_id = ${browser.sessionId}`;
  await libraryFor(browser.Cookie);
  await assertCode(
    await post(
      "/api/v1/account/email/verify",
      { ...browser.identity, challengeId: challenge.challengeId, code },
      headers
    ),
    403,
    "fresh_auth_required"
  );
  const observed1 = await libraryFor(browser.Cookie);
  expect(observed1.account.email).toBe(browser.email);
});

test("device-provenance cookies and direct sensitive auth routes cannot acquire browser privileges", async () => {
  const browser = await freshSocialBrowser();
  const headers = { Cookie: browser.Cookie };
  await sql`UPDATE session SET provenance = 'device' WHERE id = ${browser.sessionId}`;
  await assertCode(
    await post(
      "/api/auth/device/approve",
      {
        userCode: "ABCD2345",
        accountId: browser.identity.accountId,
      },
      headers
    ),
    403,
    "forbidden"
  );
  await assertCode(
    await fetch(`${origin}/api/v1/account`, { headers }),
    403,
    "forbidden"
  );
  for (const path of [
    "reauth/challenges",
    "reauth/verify",
    "email/challenges",
    "email/verify",
  ]) {
    await assertCode(
      await post(`/api/v1/account/${path}`, browser.identity, headers),
      403,
      "forbidden"
    );
  }
  for (const route of [
    "change-email",
    "change-password",
    "set-password",
    "verify-password",
    "link-social",
    "unlink-account",
    "delete-user",
    "delete-user/callback",
    "update-user",
    "email-otp/send-verification-otp",
    "email-otp/check-verification-otp",
    "email-otp/change-email",
    "email-otp/verify-email",
    "get-session",
  ]) {
    await assertCode(
      await post(`/api/auth/${route}`, {}, headers),
      404,
      "not_found"
    );
    await assertCode(
      await fetch(`${origin}/api/auth/${route}`, { headers }),
      404,
      "not_found"
    );
  }
});

test("replacement verification resends and races preserve ownership and invalidate every prior proof", async () => {
  const browser = await freshSocialBrowser();
  const headers = { Cookie: browser.Cookie };
  const email = `${crypto.randomUUID()}@example.test`;
  const initial = await post(
    "/api/v1/account/email/challenges",
    { ...browser.identity, email },
    headers
  );
  const first = await initial.json();
  const oldCode = await emailCode(email);
  const resent = await post(
    "/api/v1/account/email/challenges",
    { ...browser.identity, email },
    headers
  );
  const second = await resent.json();
  const code = await emailCode(email, [oldCode]);
  await assertCode(
    await post(
      "/api/v1/account/email/verify",
      { ...browser.identity, challengeId: first.challengeId, code: oldCode },
      headers
    ),
    400,
    "invalid_challenge"
  );
  const outcomes = await Promise.all(
    Array.from({ length: 2 }, () =>
      post(
        "/api/v1/account/email/verify",
        { ...browser.identity, challengeId: second.challengeId, code },
        headers
      )
    )
  );
  expect(new Set(outcomes.map((result) => result.status))).toEqual(
    new Set([200, 409])
  );
  const observed2 = await libraryFor(browser.Cookie);
  expect(observed2.account.email).toBe(email);
  await assertCode(
    await post(
      "/api/v1/account/email/challenges",
      {
        accountId: browser.identity.accountId,
        emailVersion: 1,
        email: "third@example.test",
      },
      headers
    ),
    403,
    "fresh_auth_required"
  );
});

test("unverified requests and cross-origin mutations fail before sending email", async () => {
  const browser = await socialBrowser();
  await assertCode(
    await post("/api/v1/account/reauth/challenges", browser.identity),
    401,
    "unauthenticated"
  );
  await assertCode(
    await post("/api/v1/account/reauth/challenges", browser.identity, {
      Cookie: browser.Cookie,
      Origin: "https://other.example",
    }),
    403,
    "forbidden"
  );
  await assertCode(
    await post(
      "/api/v1/account/reauth/challenges",
      { ...browser.identity, extra: true },
      { Cookie: browser.Cookie }
    ),
    400,
    "invalid_input"
  );
});

test("email changes only after fresh authentication and new-address verification, preserving account ownership", async () => {
  const email = `${crypto.randomUUID()}@example.test`;
  const nextEmail = `${crypto.randomUUID()}@example.test`;
  const Cookie = cookieFrom(await githubLogin(crypto.randomUUID(), email));
  const before = await libraryFor(Cookie);
  const identity = { accountId: before.account.id, emailVersion: 0 };
  const headers = { Cookie };
  const denied = await post(
    "/api/v1/account/email/challenges",
    { ...identity, email: nextEmail },
    headers
  );
  expect(await denied.json()).toEqual({ code: "fresh_auth_required" });
  const challenge = await post(
    "/api/v1/account/reauth/challenges",
    identity,
    headers
  );
  const { challengeId } = await challenge.json();
  await post(
    "/api/v1/account/reauth/verify",
    { ...identity, challengeId, code: await emailCode(email) },
    headers
  );
  const request = await post(
    "/api/v1/account/email/challenges",
    { ...identity, email: nextEmail },
    headers
  );
  expect(request.status).toBe(202);
  const observed3 = await libraryFor(Cookie);
  expect(observed3.account.email).toBe(email);
  const verification = await request.json();
  const confirmed = await post(
    "/api/v1/account/email/verify",
    {
      ...identity,
      challengeId: verification.challengeId,
      code: await emailCode(nextEmail),
    },
    headers
  );
  expect(confirmed.status).toBe(200);
  expect(await confirmed.json()).toEqual({
    status: "email_changed",
    notification: "pending",
  });
  const after = await libraryFor(Cookie);
  expect(after.account).toEqual({ ...before.account, email: nextEmail });
  const settings = await fetch(`${origin}/api/v1/account`, { headers });
  expect(await settings.json()).toMatchObject({
    accountId: before.account.id,
    email: nextEmail,
    emailVersion: 1,
    freshUntil: null,
  });
});

test("a social-only account proves freshness with its browser-bound verified-email code", async () => {
  const email = `${crypto.randomUUID()}@example.test`;
  const login = await githubLogin(crypto.randomUUID(), email);
  const Cookie = cookieFrom(login);
  const library = await libraryFor(Cookie);
  const identity = { accountId: library.account.id, emailVersion: 0 };
  const response = await post("/api/v1/account/reauth/challenges", identity, {
    Cookie,
  });
  expect(response.status).toBe(202);
  const { challengeId } = await response.json();
  const code = await emailCode(email);
  const verified = await post(
    "/api/v1/account/reauth/verify",
    { ...identity, challengeId, code },
    { Cookie }
  );
  expect(verified.status).toBe(200);
  expect(await verified.json()).toMatchObject({ status: "fresh" });
});
