// oxlint-disable eslint/no-await-in-loop -- Each adversarial callback scenario completes before the next to isolate state and admission.
import { expect, test } from "bun:test";

import { SQL } from "bun";

import {
  accountEmailLink,
  cookieFrom,
  ingressHeaders,
  origin,
  post,
  password as signupPassword,
} from "./http-fixture";
import {
  githubLogin,
  googleLogin,
  libraryFor,
  statusOf,
  stateFrom,
} from "./social-fixture";

test("enabled providers offer a browser authorization URL with a fixed callback and reject forged origins", async () => {
  const providers = await fetch(`${origin}/api/auth/providers`);
  expect(await providers.json()).toEqual({ providers: ["google", "github"] });
  const start = await post("/api/auth/sign-in/social", { provider: "github" });
  expect(start.status).toBe(200);
  const { url } = await start.json();
  const target = new URL(url);
  expect(target.origin).toBe("https://github.com");
  expect(target.searchParams.get("redirect_uri")).toBe(
    `${origin}/api/auth/callback/github`
  );
  expect(target.searchParams.get("state")).toBeTruthy();
  expect(target.searchParams.get("code_challenge")).toBeTruthy();
  expect(
    await statusOf(
      post(
        "/api/auth/sign-in/social",
        { provider: "github" },
        { Origin: "https://evil.example" }
      )
    )
  ).toBe(403);
  expect(
    await statusOf(
      post("/api/auth/sign-in/social", {
        provider: "github",
        callbackURL: "https://evil.example",
      })
    )
  ).toBe(400);
});

test("Google requires signed identity claims bound to this instance and authorization nonce", async () => {
  const signedIn = await googleLogin();
  expect(signedIn.headers.get("location")).toBe(`${origin}/`);
  expect(
    await statusOf(
      fetch(`${origin}/api/v1/library`, {
        headers: { ...ingressHeaders(), Cookie: cookieFrom(signedIn) },
      })
    )
  ).toBe(200);
  for (const extra of [
    { aud: "other-instance" },
    { nonce: "other-browser" },
    { iss: "https://evil.example" },
    { exp: 1 },
    { badSignature: true },
  ]) {
    const rejected = await googleLogin(extra);
    expect(rejected.headers.get("location")).toBe(`${origin}/?social=invalid`);
    expect(cookieFrom(rejected)).not.toContain("session_token");
  }
});

test("callbacks reject denial, missing or stolen state, provider mixups, and replay", async () => {
  const start = await post("/api/auth/sign-in/social", { provider: "github" });
  const { url } = await start.json();
  const state = new URL(url).searchParams.get("state");
  const code = Buffer.from(
    JSON.stringify({
      id: crypto.randomUUID(),
      email: `${crypto.randomUUID()}@example.test`,
      verified: true,
    })
  ).toString("base64url");
  const callback = `${origin}/api/auth/callback/github?state=${state}&code=${code}`;
  const Cookie = cookieFrom(start);
  for (const [target, cookie] of [
    [callback, ""],
    [callback.replace("github?", "google?"), Cookie],
    [callback.replace(`state=${state}`, "state=forged"), Cookie],
  ] as const) {
    const denied = await fetch(target, {
      headers: { ...ingressHeaders(), Cookie: cookie },
      redirect: "manual",
    });
    expect(denied.headers.get("location")).toBe(`${origin}/?social=invalid`);
    expect(cookieFrom(denied)).not.toContain("session_token");
  }
  // A mixup can consume Better Auth's state; use a fresh authorization for the replay check.
  const fresh = await post("/api/auth/sign-in/social", { provider: "github" });
  const freshState = await stateFrom(fresh);
  const target = callback.replace(String(state), String(freshState));
  const first = await fetch(target, {
    headers: { ...ingressHeaders(), Cookie: cookieFrom(fresh) },
    redirect: "manual",
  });
  expect(first.headers.get("location")).toBe(`${origin}/`);
  const replay = await fetch(target, {
    headers: { ...ingressHeaders(), Cookie: cookieFrom(fresh) },
    redirect: "manual",
  });
  expect(replay.headers.get("location")).toBe(`${origin}/?social=invalid`);
  const denialStart = await post("/api/auth/sign-in/social", {
    provider: "github",
  });
  const denialState = await stateFrom(denialStart);
  const denial = await fetch(
    `${origin}/api/auth/callback/github?state=${denialState}&error=access_denied`,
    {
      headers: { ...ingressHeaders(), Cookie: cookieFrom(denialStart) },
      redirect: "manual",
    }
  );
  expect(denial.headers.get("location")).toBe(`${origin}/?social=invalid`);
  expect(cookieFrom(denial)).not.toContain("session_token");
});

test("a missing provider email needs a browser-bound verified address before library access", async () => {
  const id = crypto.randomUUID();
  const callback = await githubLogin(id);
  expect(callback.headers.get("location")).toBe(`${origin}/social-email`);
  const Cookie = cookieFrom(callback);
  expect(
    await statusOf(
      fetch(`${origin}/api/v1/library`, {
        headers: { ...ingressHeaders(), Cookie },
      })
    )
  ).toBe(401);
  const email = `${id}@example.test`;
  const requested = await post("/api/auth/social/email", { email }, { Cookie });
  expect(requested.status).toBe(202);
  const link = await accountEmailLink(email);
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
  expect(await statusOf(post("/api/auth/social/verify", { token }))).toBe(400);
  const verified = await post("/api/auth/social/verify", { token }, { Cookie });
  expect(verified.status).toBe(200);
  const library = await fetch(`${origin}/api/v1/library`, {
    headers: { ...ingressHeaders(), Cookie: cookieFrom(verified) },
  });
  expect(library.status).toBe(200);
  const verifiedLibrary = await library.json();
  expect(verifiedLibrary.account.email).toBe(email);
  expect(
    await statusOf(post("/api/auth/social/verify", { token }, { Cookie }))
  ).toBe(400);
  const returning = await githubLogin(id);
  expect(returning.headers.get("location")).toBe(`${origin}/`);
});

test("verified provider login reaches an immutable library without linking matching emails", async () => {
  const id = crypto.randomUUID();
  const email = `${id}@example.test`;
  const first = await githubLogin(id, email);
  expect(first.status).toBe(303);
  expect(first.headers.get("location")).toBe(`${origin}/`);
  const library = await fetch(`${origin}/api/v1/library`, {
    headers: { ...ingressHeaders(), Cookie: cookieFrom(first) },
  });
  expect(library.status).toBe(200);
  const identity = await library.json();
  expect(identity.account.email).toBe(email);
  const returning = await githubLogin(id, "changed@example.test", false);
  const returned = await fetch(`${origin}/api/v1/library`, {
    headers: { ...ingressHeaders(), Cookie: cookieFrom(returning) },
  });
  const returnedLibrary = await returned.json();
  expect(returnedLibrary.account).toEqual(identity.account);
  const collision = await githubLogin(crypto.randomUUID(), email);
  expect(collision.headers.get("location")).toBe(
    `${origin}/?social=account_not_linked`
  );
  expect(cookieFrom(collision)).not.toContain("session_token");
});

test("unverified email stays pending; resend, expiry, and competing verification preserve access safeguards", async () => {
  const id = crypto.randomUUID();
  const email = `${id}@example.test`;
  const pending = await githubLogin(id, email, false);
  expect(pending.headers.get("location")).toBe(`${origin}/social-email`);
  const Cookie = cookieFrom(pending);
  await post("/api/auth/social/email", { email }, { Cookie });
  const firstLink = await accountEmailLink(email);
  const firstToken =
    new URLSearchParams(new URL(firstLink).hash.slice(1)).get("token") ?? "";
  await post("/api/auth/social/email", { email }, { Cookie });
  const latestLink = await accountEmailLink(email, undefined, firstToken);
  const token = new URLSearchParams(new URL(latestLink).hash.slice(1)).get(
    "token"
  );
  expect(
    await statusOf(
      post("/api/auth/social/verify", { token: firstToken }, { Cookie })
    )
  ).toBe(400);
  const responses = await Promise.all([
    post("/api/auth/social/verify", { token }, { Cookie }),
    post("/api/auth/social/verify", { token }, { Cookie }),
  ]);
  expect(new Set(responses.map((response) => response.status))).toEqual(
    new Set([200, 400])
  );
  const expired = await githubLogin(crypto.randomUUID());
  const expiredCookie = cookieFrom(expired);
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  await sql`UPDATE social_pending SET expires_at = now() - interval '1 second'`;
  await sql.close();
  expect(
    await statusOf(
      post(
        "/api/auth/social/email",
        { email: `${crypto.randomUUID()}@example.test` },
        { Cookie: expiredCookie }
      )
    )
  ).toBe(400);
}, 20_000);

test("a social-only account recovers through its retained verified email and both methods keep its library", async () => {
  const id = crypto.randomUUID();
  const email = `${id}@example.test`;
  const login = await githubLogin(id, email);
  const Cookie = cookieFrom(login);
  const before = await libraryFor(Cookie);
  expect(
    await statusOf(post("/api/auth/request-password-reset", { email }))
  ).toBe(202);
  const link = await accountEmailLink(email, "Reset your pr0 password");
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
  const password = "recovered-social-account-password";
  expect(
    await statusOf(
      post("/api/auth/reset-password", { token, newPassword: password })
    )
  ).toBe(200);
  expect(
    await statusOf(
      fetch(`${origin}/api/v1/library`, {
        headers: { Cookie, ...ingressHeaders() },
      })
    )
  ).toBe(401);
  const passwordLogin = await post("/api/auth/sign-in/email", {
    email,
    password,
  });
  const recovered = await libraryFor(cookieFrom(passwordLogin));
  expect(recovered.account.id).toBe(before.account.id);
  const providerLogin = await githubLogin(id);
  const returned = await libraryFor(cookieFrom(providerLogin));
  expect(returned.account).toEqual(before.account);
}, 20_000);

test("unlisted provider-library routes and forged proof fields cannot bypass the public contract", async () => {
  for (const path of [
    "social/start",
    "link-social",
    "sign-up/social",
    "callback/github",
    "get-access-token",
  ]) {
    expect(
      await statusOf(post(`/api/auth/${path}`, { provider: "github" }))
    ).toBe(404);
  }
  for (const extra of [
    { idToken: { token: "forged" } },
    { requestSignUp: true },
    { additionalData: { provider: "google" } },
  ]) {
    expect(
      await statusOf(
        post("/api/auth/sign-in/social", { provider: "github", ...extra })
      )
    ).toBe(400);
  }
  const forged = await fetch(
    `${origin}/api/auth/callback/github?state=forged`,
    {
      headers: { Origin: "https://evil.example", ...ingressHeaders() },
      redirect: "manual",
    }
  );
  expect(forged.status).toBe(403);
});

test("password and OAuth account creation share five signup attempts per hour without blocking returning providers", async () => {
  const headers = { ...ingressHeaders(), "x-pr0-client-ip": "198.19.26.26" };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await post(
      "/api/auth/sign-up/email",
      {
        email: `${crypto.randomUUID()}@example.test`,
        password: signupPassword,
      },
      headers
    );
    expect(response.status).toBe(202);
  }
  const subject = crypto.randomUUID();
  const first = await githubLogin(
    subject,
    `${crypto.randomUUID()}@example.test`,
    true,
    headers
  );
  expect(first.headers.get("location")).toBe(`${origin}/`);
  const denied = await githubLogin(
    crypto.randomUUID(),
    `${crypto.randomUUID()}@example.test`,
    true,
    headers
  );
  expect(
    new URL(denied.headers.get("location") ?? origin).searchParams.get("social")
  ).toBe("rate_limited");
  expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  await Bun.sleep(10_100);
  const returning = await githubLogin(subject, undefined, false, headers);
  expect(returning.headers.get("location")).toBe(`${origin}/`);
  const pending = await githubLogin(crypto.randomUUID());
  const Cookie = cookieFrom(pending);
  const email = `${crypto.randomUUID()}@example.test`;
  await post("/api/auth/social/email", { email }, { Cookie });
  const link = await accountEmailLink(email);
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
  const completed = await post(
    "/api/auth/social/verify",
    { token },
    { Cookie, ...headers }
  );
  expect(completed.status).toBe(429);
  expect(Number(completed.headers.get("retry-after"))).toBeGreaterThan(3000);
}, 20_000);
