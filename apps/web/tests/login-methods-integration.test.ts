// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Security scenarios change one external condition at a time and observe public HTTP.
import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import {
  emailCode,
  freshSocialBrowser,
  socialBrowser,
} from "./email-change-fixture";
import {
  accountEmailLink,
  cookieFrom,
  mergeCookies,
  ingressHeaders,
  origin,
  post,
  password,
} from "./http-fixture";
import { startLink, methodsFor } from "./login-methods-fixture";
import { githubLogin, libraryFor } from "./social-fixture";
// SQL changes only external clock/provenance fixtures. All assertions use public requests.
const sql = new SQL(process.env.DATABASE_URL ?? "");
afterAll(async () => {
  await sql.close();
});
test("ordinary sessions cannot link or remove methods, and direct auth routes cannot bypass the proof", async () => {
  const browser = await socialBrowser();
  const { methods } = await methodsFor(browser.Cookie);
  for (const [path, input] of [
    ["link", { ...browser.identity, provider: "google" }],
    ["remove", { ...browser.identity, methodId: methods[0]?.id }],
  ] as const) {
    const response = await post(`/api/v1/account/methods/${path}`, input, {
      Cookie: browser.Cookie,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "fresh_auth_required",
    });
  }
  for (const path of [
    "link-social",
    "unlink-account",
    "social/link",
    "social/start",
    "social/callback/google",
    "list-accounts",
  ]) {
    const deniedPost = await post(
      `/api/auth/${path}`,
      {},
      { Cookie: browser.Cookie }
    );
    expect(deniedPost.status).toBe(404);
    const deniedGet = await fetch(`${origin}/api/auth/${path}`, {
      headers: { Cookie: browser.Cookie },
    });
    expect(deniedGet.status).toBe(404);
  }
  const unchangedMethods = await methodsFor(browser.Cookie);
  expect(unchangedMethods.methods).toEqual(methods);
});
test("same-email sign-in never links automatically, but explicit linking does", async () => {
  const browser = await freshSocialBrowser();
  const sub = crypto.randomUUID();
  const signin = await post("/api/auth/sign-in/social", { provider: "google" });
  const signInRedirect = await signin.json();
  const target = new URL(signInRedirect.url);
  const code = Buffer.from(
    JSON.stringify({
      sub,
      email: browser.email,
      email_verified: true,
      nonce: target.searchParams.get("nonce"),
    })
  ).toString("base64url");
  const response = await fetch(
    `${origin}/api/auth/callback/google?state=${target.searchParams.get("state")}&code=${code}`,
    {
      headers: { ...ingressHeaders(), Cookie: cookieFrom(signin) },
      redirect: "manual",
    }
  );
  expect(response.headers.get("location")).toBe(
    `${origin}/?social=account_not_linked`
  );
  const methodsBeforeLink = await methodsFor(browser.Cookie);
  expect(methodsBeforeLink.methods).toHaveLength(1);
  const link = await startLink(browser);
  const linkedResponse = await link.complete(sub, browser.email);
  expect(linkedResponse.headers.get("location")).toBe(
    `${origin}/?methods=linked`
  );
  const methodsAfterLink = await methodsFor(browser.Cookie);
  expect(methodsAfterLink.methods).toHaveLength(2);
});
test("competing accounts cannot take the same provider identity or merge libraries", async () => {
  const first = await freshSocialBrowser();
  const second = await freshSocialBrowser();
  const links = await Promise.all([startLink(first), startLink(second)]);
  const sub = crypto.randomUUID();
  const results = await Promise.all(
    links.map((link) => link.complete(sub, "shared-provider@example.test"))
  );
  expect(
    new Set(results.map((response) => response.headers.get("location")))
  ).toEqual(
    new Set([`${origin}/?methods=linked`, `${origin}/?methods=provider_owned`])
  );
  const methods = await Promise.all([
    methodsFor(first.Cookie),
    methodsFor(second.Cookie),
  ]);
  expect(new Set(methods.map((result) => result.methods.length))).toEqual(
    new Set([1, 2])
  );
  const firstLibrary = await libraryFor(first.Cookie);
  expect(firstLibrary.account.id).toBe(first.identity.accountId);
  const secondLibrary = await libraryFor(second.Cookie);
  expect(secondLibrary.account.id).toBe(second.identity.accountId);
  const loser = methods[0]?.methods.length === 1 ? first : second;
  const retry = await startLink(loser);
  const ownedProviderResponse = await retry.complete(
    sub,
    "shared-provider@example.test"
  );
  expect(ownedProviderResponse.headers.get("location")).toBe(
    `${origin}/?methods=provider_owned`
  );
});
test("cancellation, failed callbacks and replay preserve the original login methods", async () => {
  const browser = await freshSocialBrowser();
  const before = await methodsFor(browser.Cookie);
  const cancel = await startLink(browser);
  const cancelledResponse = await cancel.complete(
    "unused",
    undefined,
    cancel.Cookie,
    "access_denied"
  );
  expect(cancelledResponse.headers.get("location")).toBe(
    `${origin}/?methods=invalid`
  );
  const methodsAfterCancellation = await methodsFor(browser.Cookie);
  expect(methodsAfterCancellation.methods).toEqual(before.methods);
  const replayedResponse = await cancel.complete(
    "unused",
    "unused@example.test"
  );
  expect(replayedResponse.headers.get("location")).not.toBe(
    `${origin}/?methods=linked`
  );
  const failure = await startLink(browser);
  const failedResponse = await failure.complete("", "unused@example.test");
  expect(failedResponse.headers.get("location")).toBe(
    `${origin}/?methods=invalid`
  );
  const methodsAfterFailure = await methodsFor(browser.Cookie);
  expect(methodsAfterFailure.methods).toEqual(before.methods);
});
test("callback completion rechecks proof expiry and removal cannot renew expired freshness", async () => {
  const browser = await freshSocialBrowser();
  const link = await startLink(browser);
  const before = await methodsFor(browser.Cookie);
  await sql`UPDATE fresh_auth SET expires_at = clock_timestamp() - interval '1 second' WHERE session_id = ${browser.sessionId}`;
  await libraryFor(browser.Cookie);
  const expiredProofResponse = await link.complete(
    crypto.randomUUID(),
    "later@example.test"
  );
  expect(expiredProofResponse.headers.get("location")).toBe(
    `${origin}/?methods=fresh_auth_required`
  );
  const removal = await post(
    "/api/v1/account/methods/remove",
    { ...browser.identity, methodId: before.methods[0]?.id },
    { Cookie: browser.Cookie }
  );
  expect(removal.status).toBe(403);
  const methodsAfterExpiry = await methodsFor(browser.Cookie);
  expect(methodsAfterExpiry.methods).toEqual(before.methods);
});
test("callback completion rejects another browser, changed account, revoked session and device provenance", async () => {
  const browser = await freshSocialBrowser();
  const other = await socialBrowser();
  const sameAccount = cookieFrom(
    await githubLogin(browser.subject, browser.email)
  );
  for (const Cookie of [other.Cookie, sameAccount]) {
    const link = await startLink(browser);
    const response = await link.complete(
      crypto.randomUUID(),
      "unused@example.test",
      mergeCookies(Cookie, link.stateCookie)
    );
    expect(response.headers.get("location")).toBe(
      `${origin}/?methods=account_changed`
    );
  }
  const deviceLink = await startLink(browser);
  await sql`UPDATE session SET provenance = 'device' WHERE id = ${browser.sessionId}`;
  const deviceCallbackResponse = await deviceLink.complete(
    crypto.randomUUID(),
    "unused@example.test"
  );
  expect(deviceCallbackResponse.headers.get("location")).toBe(
    `${origin}/?methods=unauthenticated`
  );
  const deviceLinkResponse = await post(
    "/api/v1/account/methods/link",
    { ...browser.identity, provider: "google" },
    { Cookie: browser.Cookie }
  );
  expect(deviceLinkResponse.status).toBe(403);
  const deviceRemovalResponse = await post(
    "/api/v1/account/methods/remove",
    { ...browser.identity, methodId: crypto.randomUUID() },
    { Cookie: browser.Cookie }
  );
  expect(deviceRemovalResponse.status).toBe(403);
  const revocable = await freshSocialBrowser();
  const revokedLink = await startLink(revocable);
  await post("/api/auth/sign-out", {}, { Cookie: revocable.Cookie });
  const revokedCallbackResponse = await revokedLink.complete(
    crypto.randomUUID(),
    "unused@example.test"
  );
  expect(revokedCallbackResponse.headers.get("location")).toBe(
    `${origin}/?methods=unauthenticated`
  );
  const retainedMethods = await methodsFor(sameAccount);
  expect(retainedMethods.methods).toHaveLength(1);
});
test("a verified email change invalidates an outstanding link's account version", async () => {
  const browser = await freshSocialBrowser();
  const link = await startLink(browser);
  const email = `${crypto.randomUUID()}@example.test`;
  const challenge = await post(
    "/api/v1/account/email/challenges",
    { ...browser.identity, email },
    { Cookie: browser.Cookie }
  );
  const { challengeId } = await challenge.json();
  const changedEmailResponse = await post(
    "/api/v1/account/email/verify",
    { ...browser.identity, challengeId, code: await emailCode(email) },
    { Cookie: browser.Cookie }
  );
  expect(changedEmailResponse.status).toBe(200);
  const staleCallbackResponse = await link.complete(
    crypto.randomUUID(),
    "unused@example.test"
  );
  expect(staleCallbackResponse.headers.get("location")).toBe(
    `${origin}/?methods=account_changed`
  );
  const methodsAfterEmailChange = await methodsFor(browser.Cookie);
  expect(methodsAfterEmailChange.methods).toHaveLength(1);
  const changedLibrary = await libraryFor(browser.Cookie);
  expect(changedLibrary.account.email).toBe(email);
});
test("password removal leaves the linked GitHub method usable and rejects the removed password", async () => {
  const email = `${crypto.randomUUID()}@example.test`;
  await post("/api/auth/sign-up/email", { email, password });
  await fetch(await accountEmailLink(email), { redirect: "manual" });
  const Cookie = cookieFrom(
    await post("/api/auth/sign-in/email", { email, password })
  );
  const library = await libraryFor(Cookie);
  const identity = { accountId: library.account.id, emailVersion: 0 };
  await post(
    "/api/v1/account/reauth/verify",
    { ...identity, password },
    { Cookie }
  );
  const link = await startLink({ Cookie, identity }, "github");
  const subject = crypto.randomUUID();
  const githubLinkedResponse = await link.complete(subject);
  expect(githubLinkedResponse.headers.get("location")).toBe(
    `${origin}/?methods=linked`
  );
  const methods = await methodsFor(Cookie);
  const methodId = methods.methods.find(
    (method) => method.provider === "credential"
  )?.id;
  const passwordRemovalResponse = await post(
    "/api/v1/account/methods/remove",
    { ...identity, methodId },
    { Cookie }
  );
  expect(passwordRemovalResponse.status).toBe(200);
  const removedPasswordResponse = await post("/api/auth/sign-in/email", {
    email,
    password,
  });
  expect(removedPasswordResponse.status).toBe(401);
  const returning = await githubLogin(subject);
  const returningLibrary = await libraryFor(cookieFrom(returning));
  expect(returningLibrary.account).toEqual(library.account);
  const remaining = await methodsFor(Cookie);
  const last = await post(
    "/api/v1/account/methods/remove",
    { ...identity, methodId: remaining.methods[0]?.id },
    { Cookie }
  );
  expect(await last.json()).toEqual({ code: "last_login_method" });
});
test("method mutations reject stale identity, another owner's method, malformed input and cross-origin requests", async () => {
  const browser = await freshSocialBrowser();
  const other = await socialBrowser();
  const otherMethods = await methodsFor(other.Cookie);
  const foreign = otherMethods.methods[0]?.id;
  const foreignRemovalResponse = await post(
    "/api/v1/account/methods/remove",
    { ...browser.identity, methodId: foreign },
    { Cookie: browser.Cookie }
  );
  expect(foreignRemovalResponse.status).toBe(404);
  const staleIdentityResponse = await post(
    "/api/v1/account/methods/link",
    { ...browser.identity, emailVersion: 1, provider: "google" },
    { Cookie: browser.Cookie }
  );
  expect(staleIdentityResponse.status).toBe(409);
  const malformedResponse = await post(
    "/api/v1/account/methods/link",
    {
      ...browser.identity,
      provider: "google",
      callbackURL: "https://evil.example",
    },
    { Cookie: browser.Cookie }
  );
  expect(malformedResponse.status).toBe(400);
  const crossOriginResponse = await post(
    "/api/v1/account/methods/link",
    { ...browser.identity, provider: "google" },
    { Cookie: browser.Cookie, Origin: "https://evil.example" }
  );
  expect(crossOriginResponse.status).toBe(403);
  const expired = await startLink(browser);
  await sql`UPDATE social_attempt SET expires_at = clock_timestamp() - interval '1 second' WHERE state_hash = ${new Bun.CryptoHasher("sha256").update(expired.state ?? "").digest("hex")}`;
  const expiredStateResponse = await expired.complete(
    crypto.randomUUID(),
    "unused@example.test"
  );
  expect(expiredStateResponse.headers.get("location")).toBe(
    `${origin}/?methods=invalid`
  );
  const methodsAfterStateExpiry = await methodsFor(browser.Cookie);
  expect(methodsAfterStateExpiry.methods).toHaveLength(1);
});
test("concurrent removals retain one usable method and preserve library ownership", async () => {
  const browser = await freshSocialBrowser();
  const link = await startLink(browser);
  const linkedResponse = await link.complete(
    crypto.randomUUID(),
    "other@example.test"
  );
  expect(linkedResponse.headers.get("location")).toBe(
    `${origin}/?methods=linked`
  );
  const { methods } = await methodsFor(browser.Cookie);
  expect(methods).toHaveLength(2);
  const outcomes = await Promise.all(
    methods.map((method: { id: string }) =>
      post(
        "/api/v1/account/methods/remove",
        { ...browser.identity, methodId: method.id },
        { Cookie: browser.Cookie }
      )
    )
  );
  expect(new Set(outcomes.map((response) => response.status))).toEqual(
    new Set([200, 409])
  );
  const refused = outcomes.find((response) => response.status === 409);
  expect(await refused?.json()).toEqual({ code: "last_login_method" });
  const remainingMethods = await methodsFor(browser.Cookie);
  expect(remainingMethods.methods).toHaveLength(1);
  const retainedLibrary = await libraryFor(browser.Cookie);
  expect(retainedLibrary.account.id).toBe(browser.identity.accountId);
});

test("an additional identity for an already linked provider gives actionable guidance without replacing it", async () => {
  const browser = await freshSocialBrowser();
  const link = await startLink(browser, "github");
  const result = await link.complete(
    crypto.randomUUID(),
    "different-github@example.test"
  );
  expect(result.headers.get("location")).toBe(
    `${origin}/?methods=method_already_linked`
  );
  const unchanged = await methodsFor(browser.Cookie);
  expect(unchanged.methods).toHaveLength(1);
  const returning = await githubLogin(browser.subject, browser.email);
  const library = await libraryFor(cookieFrom(returning));
  expect(library.account.id).toBe(browser.identity.accountId);
});
test("explicit different-email linking preserves the account and returning Google sign-in reaches its library", async () => {
  const browser = await freshSocialBrowser();
  const before = await libraryFor(browser.Cookie);
  const start = await post(
    "/api/v1/account/methods/link",
    {
      ...browser.identity,
      provider: "google",
    },
    { Cookie: browser.Cookie }
  );
  expect(start.status).toBe(200);
  expect(start.headers.get("cache-control")).toBe("no-store");
  expect(start.headers.get("referrer-policy")).toBe("no-referrer");
  const { url } = await start.json();
  const authorization = new URL(url);
  const sub = crypto.randomUUID();
  const email = `${crypto.randomUUID()}@example.test`;
  const code = Buffer.from(
    JSON.stringify({
      sub,
      email,
      email_verified: true,
      nonce: authorization.searchParams.get("nonce"),
    })
  ).toString("base64url");
  const callback = await fetch(
    `${origin}/api/auth/callback/google?state=${authorization.searchParams.get("state")}&code=${code}`,
    {
      headers: {
        ...ingressHeaders(),
        Cookie: mergeCookies(browser.Cookie, cookieFrom(start)),
      },
      redirect: "manual",
    }
  );
  expect(callback.headers.get("location")).toBe(`${origin}/?methods=linked`);
  const linkedLibrary = await libraryFor(browser.Cookie);
  expect(linkedLibrary.account).toEqual(before.account);
  const returning = await post("/api/auth/sign-in/social", {
    provider: "google",
  });
  const returningRedirect = await returning.json();
  const returningUrl = new URL(returningRedirect.url);
  const returningCode = Buffer.from(
    JSON.stringify({
      sub,
      email,
      email_verified: true,
      nonce: returningUrl.searchParams.get("nonce"),
    })
  ).toString("base64url");
  const login = await fetch(
    `${origin}/api/auth/callback/google?state=${returningUrl.searchParams.get("state")}&code=${returningCode}`,
    {
      headers: { ...ingressHeaders(), Cookie: cookieFrom(returning) },
      redirect: "manual",
    }
  );
  const returningLibrary = await libraryFor(cookieFrom(login));
  expect(returningLibrary.account).toEqual(before.account);
});
