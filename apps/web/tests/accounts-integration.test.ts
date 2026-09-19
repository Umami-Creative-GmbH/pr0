// oxlint-disable eslint/no-await-in-loop -- Poll the controlled external SMTP sink for asynchronous delivery.
// oxlint-disable anti-slop/no-unknown-parameters -- This HTTP test intentionally sends malformed public request bodies.
import { expect, test } from "bun:test";

import { librarySchema } from "@pr0/api-contract/accounts";

import {
  cookieFrom,
  ingressHeaders,
  origin,
  password,
  post,
  accountEmailLink,
} from "./http-fixture";

const email = `account-${crypto.randomUUID()}@example.test`;

test("unverified signup cannot access its private library or sign in", async () => {
  const response = await post("/api/auth/sign-up/email", { email, password });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ status: "verification_required" });
  expect(response.headers.get("set-cookie")).toBeNull();
  const library = await fetch(`${origin}/api/v1/library`);
  expect(library.status).toBe(401);
  const login = await post("/api/auth/sign-in/email", { email, password });
  expect(login.status).toBe(401);
  expect(await login.json()).toEqual({ code: "invalid_credentials" });
});

test("verification email enables a private library with a renewable browser session", async () => {
  const link = await accountEmailLink(email);
  expect(link).toBeString();
  const verification = await fetch(link, { redirect: "manual" });
  expect(verification.status).toBe(303);
  expect(verification.headers.get("location")).toBe(`${origin}/?verified=1`);
  const login = await post("/api/auth/sign-in/email", { email, password });
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  expect(cookie).toContain("session_token");
  expect(login.headers.get("set-cookie")).toContain("HttpOnly");
  expect(login.headers.get("set-cookie")).toContain("SameSite=Lax");
  expect(await login.json()).toEqual({ status: "ok" });
  const library = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: cookie },
  });
  expect(library.status).toBe(200);
  const body = await library.json();
  expect(body.account.email).toBe(email);
  expect(body.account.verified).toBe(true);
  expect(body.prompts).toEqual([]);
  expect(body.revision).toBe("0");
  expect(body.session.provenance).toBe("browser");
  expect(Date.parse(body.session.expiresAt) - Date.now()).toBeGreaterThan(
    29 * 24 * 60 * 60 * 1000
  );
  expect(library.headers.get("set-cookie")).toContain("session_token");
  const logout = await post("/api/auth/sign-out", {}, { Cookie: cookie });
  expect(logout.status).toBe(200);
  const afterLogout = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: cookie },
  });
  expect(afterLogout.status).toBe(401);
});

const verifiedSession = async () => {
  const address = `isolation-${crypto.randomUUID()}@example.test`;
  const signup = await post("/api/auth/sign-up/email", {
    email: address,
    password,
  });
  expect(signup.status).toBe(202);
  const link = await accountEmailLink(address);
  expect(link.startsWith(`${origin}/api/auth/verify-email?`)).toBe(true);
  const verified = await fetch(link, {
    headers: { ...ingressHeaders(), "Sec-Fetch-Site": "cross-site" },
    redirect: "manual",
  });
  expect(verified.headers.get("location")).toBe(`${origin}/?verified=1`);
  const login = await post("/api/auth/sign-in/email", {
    email: address,
    password,
  });
  expect(login.status).toBe(200);
  const cookie = cookieFrom(login);
  const response = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: cookie },
  });
  return { cookie, library: librarySchema.parse(await response.json()) };
};

test("two verified accounts cannot read each other's library boundary", async () => {
  const first = await verifiedSession();
  const second = await verifiedSession();
  expect(first.library.account.id).not.toBe(second.library.account.id);
  expect(first.library.instance.id).toBe(second.library.instance.id);
  for (const [caller, target] of [
    [first, second],
    [second, first],
  ] as const) {
    const response = await fetch(
      `${origin}/api/v1/library?accountId=${target.library.account.id}`,
      { headers: { Cookie: caller.cookie } }
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "forbidden" });
  }
}, 30_000);

test("signup duplicates have the same public response and cannot mint a session", async () => {
  const address = `duplicate-${crypto.randomUUID()}@example.test`;
  const first = await post("/api/auth/sign-up/email", {
    email: address,
    password,
  });
  const second = await post("/api/auth/sign-up/email", {
    email: address,
    password,
  });
  expect(first.status).toBe(202);
  expect(second.status).toBe(202);
  expect(await second.json()).toEqual(await first.json());
  expect(second.headers.get("set-cookie")).toBeNull();
});

test("forged origins, malformed bodies, client provenance, and direct auth bypasses are rejected", async () => {
  const input = {
    email: `invalid-${crypto.randomUUID()}@example.test`,
    password,
  };
  const forged = await post("/api/auth/sign-up/email", input, {
    Origin: "https://evil.example",
  });
  expect(forged.status).toBe(403);
  const missingOrigin = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  expect(missingOrigin.status).toBe(403);
  for (const body of [
    { ...input, email: "bad" },
    { ...input, password: "short" },
    { ...input, emailVerified: true },
    { ...input, provenance: "browser" },
    { ...input, callbackURL: "https://evil.example" },
  ]) {
    const response = await post("/api/auth/sign-up/email", body);
    expect(response.status).toBe(400);
  }
  const oversized = await post("/api/auth/sign-up/email", {
    ...input,
    password: "x".repeat(5000),
  });
  expect(oversized.status).toBe(413);
  const compressed = await post("/api/auth/sign-up/email", input, {
    "Content-Encoding": "gzip",
  });
  expect(compressed.status).toBe(400);
  for (const path of [
    "update-user",
    "change-password",
    "delete-user",
    "link-social",
    "sign-in/social",
    "device/token",
    "get-session",
  ]) {
    const response = await post(`/api/auth/${path}`, {});
    expect(response.status).toBe(404);
  }
  const forgedCookie = await fetch(`${origin}/api/v1/library`, {
    headers: {
      Cookie: "better-auth.session_token=forged",
      Authorization: "Bearer forged",
    },
  });
  expect(forgedCookie.status).toBe(401);
});

test("email admission is shared by destination even when no account exists", async () => {
  const address = `mail-limit-${crypto.randomUUID()}@example.test`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await post("/api/auth/send-verification-email", {
      email: address,
    });
    expect(response.status).toBe(202);
  }
  const limited = await post("/api/auth/send-verification-email", {
    email: address,
  });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
});

test("spoofed forwarding headers cannot evade anonymous admission", async () => {
  const responses = await Promise.all(
    Array.from({ length: 11 }, (_, index) =>
      post(
        "/api/auth/sign-in/email",
        { email: "bad", password },
        {
          "x-pr0-ingress-secret": "forged",
          "x-pr0-client-ip": `192.0.2.${index + 1}`,
          "x-forwarded-for": `192.0.2.${index + 1}`,
          "x-real-ip": `192.0.2.${index + 1}`,
        }
      )
    )
  );
  expect(responses.some((response) => response.status === 429)).toBe(true);
  expect(
    responses.every((response) => [400, 429].includes(response.status))
  ).toBe(true);
});
