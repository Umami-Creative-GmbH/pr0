// oxlint-disable eslint/no-await-in-loop -- Session creation and revocation assertions are ordered public journeys.
import { expect, test } from "bun:test";

import { librarySchema, sessionsSchema } from "@pr0/api-contract/accounts";

import {
  cookieFrom,
  origin,
  password,
  post,
  accountEmailLink,
} from "./http-fixture";

const responseStatus = async (response: Promise<Response>) => {
  const result = await response;
  return result.status;
};

test("verified email recovery changes the password once and revokes every previous session", async () => {
  const email = `recovery-${crypto.randomUUID()}@example.test`;
  expect(
    await responseStatus(post("/api/auth/sign-up/email", { email, password }))
  ).toBe(202);
  await fetch(await accountEmailLink(email), { redirect: "manual" });
  const first = await post("/api/auth/sign-in/email", { email, password });
  const second = await post("/api/auth/sign-in/email", { email, password });
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  const recovery = await post("/api/auth/request-password-reset", { email });
  expect(recovery.status).toBe(202);
  expect(await recovery.json()).toEqual({ status: "recovery_requested" });
  const link = await accountEmailLink(email, "Reset your pr0 password");
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
  const newPassword = "replacement-private-password";
  const reset = await post("/api/auth/reset-password", { token, newPassword });
  expect(reset.status).toBe(200);
  expect(await reset.json()).toEqual({ status: "ok" });
  for (const cookie of [cookieFrom(first), cookieFrom(second)]) {
    expect(
      await responseStatus(
        fetch(`${origin}/api/v1/library`, { headers: { Cookie: cookie } })
      )
    ).toBe(401);
  }
  expect(
    await responseStatus(post("/api/auth/sign-in/email", { email, password }))
  ).toBe(401);
  expect(
    await responseStatus(
      post("/api/auth/sign-in/email", { email, password: newPassword })
    )
  ).toBe(200);
  expect(
    await responseStatus(
      post("/api/auth/reset-password", { token, newPassword: password })
    )
  ).toBe(400);
}, 30_000);

test("session settings revoke only the selected identity and all others preserve the caller", async () => {
  const email = `sessions-${crypto.randomUUID()}@example.test`;
  await post("/api/auth/sign-up/email", { email, password });
  await fetch(await accountEmailLink(email), { redirect: "manual" });
  const cookies: string[] = [];
  const ids: string[] = [];
  for (let count = 0; count < 3; count += 1) {
    const login = await post("/api/auth/sign-in/email", { email, password });
    const cookie = cookieFrom(login);
    cookies.push(cookie);
    const response = await fetch(`${origin}/api/v1/library`, {
      headers: { Cookie: cookie },
    });
    const library = librarySchema.parse(await response.json());
    ids.push(library.session.id);
  }
  const headers = { Cookie: cookies[0] ?? "" };
  const list = await fetch(`${origin}/api/v1/sessions`, { headers });
  expect(list.status).toBe(200);
  const body = sessionsSchema.parse(await list.json());
  expect(body.sessions).toHaveLength(3);
  expect(
    body.sessions.filter((session: { current: boolean }) => session.current)
  ).toHaveLength(1);
  expect(JSON.stringify(body)).not.toContain("token");
  expect(
    await responseStatus(
      post("/api/v1/sessions/revoke", { sessionId: ids[1] }, headers)
    )
  ).toBe(200);
  expect(
    await responseStatus(
      fetch(`${origin}/api/v1/library`, {
        headers: { Cookie: cookies[1] ?? "" },
      })
    )
  ).toBe(401);
  expect(
    await responseStatus(
      fetch(`${origin}/api/v1/library`, {
        headers: { Cookie: cookies[2] ?? "" },
      })
    )
  ).toBe(200);
  expect(
    await responseStatus(post("/api/v1/sessions/revoke-others", {}, headers))
  ).toBe(200);
  expect(
    await responseStatus(fetch(`${origin}/api/v1/library`, { headers }))
  ).toBe(200);
  expect(
    await responseStatus(
      fetch(`${origin}/api/v1/library`, {
        headers: { Cookie: cookies[2] ?? "" },
      })
    )
  ).toBe(401);
}, 30_000);

test("recovery conceals unknown and unverified accounts and shares destination admission", async () => {
  const unknown = `unknown-${crypto.randomUUID()}@example.test`;
  const unverified = `unverified-${crypto.randomUUID()}@example.test`;
  await post("/api/auth/sign-up/email", { email: unverified, password });
  for (const email of [unknown, unverified]) {
    const response = await post("/api/auth/request-password-reset", { email });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "recovery_requested" });
    expect(response.headers.get("set-cookie")).toBeNull();
  }
  const shared = `shared-${crypto.randomUUID()}@example.test`;
  await post("/api/auth/send-verification-email", { email: shared });
  await post("/api/auth/request-password-reset", { email: shared });
  await post("/api/auth/send-verification-email", { email: shared });
  const limited = await post("/api/auth/request-password-reset", {
    email: shared,
  });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(
    await responseStatus(
      post("/api/auth/sign-in/email", { email: unverified, password })
    )
  ).toBe(401);
});

test("recovery rejects invalid input, token forgery, callbacks and cross-origin requests", async () => {
  for (const body of [
    { token: "forged", newPassword: "short" },
    { token: "forged", newPassword: password, emailVerified: true },
    { token: "", newPassword: password },
  ]) {
    expect(await responseStatus(post("/api/auth/reset-password", body))).toBe(
      400
    );
  }
  const forged = await post("/api/auth/reset-password", {
    token: "forged",
    newPassword: password,
  });
  expect(forged.status).toBe(400);
  expect(await forged.json()).toEqual({ code: "invalid_recovery" });
  expect(
    await responseStatus(
      post("/api/auth/request-password-reset", {
        email: "owner@example.test",
        redirectTo: "https://evil.example",
      })
    )
  ).toBe(400);
  expect(
    await responseStatus(
      post(
        "/api/auth/request-password-reset",
        { email: "owner@example.test" },
        { Origin: "https://evil.example" }
      )
    )
  ).toBe(403);
  expect(
    await responseStatus(
      post(
        "/api/auth/reset-password",
        { token: "forged", newPassword: password },
        { Origin: "https://evil.example" }
      )
    )
  ).toBe(403);
  const bypass = await fetch(
    `${origin}/api/auth/reset-password/forged?callbackURL=https://evil.example`
  );
  expect(bypass.status).toBe(404);
});

test("session ownership prevents revoking another account and self-revocation ends access", async () => {
  const owners: { cookie: string; id: string }[] = [];
  for (let index = 0; index < 2; index += 1) {
    const email = `owner-${crypto.randomUUID()}@example.test`;
    await post("/api/auth/sign-up/email", { email, password });
    await fetch(await accountEmailLink(email), { redirect: "manual" });
    const login = await post("/api/auth/sign-in/email", { email, password });
    const cookie = cookieFrom(login);
    const response = await fetch(`${origin}/api/v1/library`, {
      headers: { Cookie: cookie },
    });
    const library = librarySchema.parse(await response.json());
    owners.push({ cookie, id: library.session.id });
  }
  const [first, second] = owners;
  if (!first || !second) {
    throw new Error("Account fixture missing");
  }
  const headers = { Cookie: first.cookie };
  expect(
    await responseStatus(
      post("/api/v1/sessions/revoke", { sessionId: second.id }, headers)
    )
  ).toBe(404);
  expect(
    await responseStatus(
      fetch(`${origin}/api/v1/library`, { headers: { Cookie: second.cookie } })
    )
  ).toBe(200);
  expect(
    await responseStatus(
      post(
        "/api/v1/sessions/revoke",
        { sessionId: first.id },
        { ...headers, Origin: "https://evil.example" }
      )
    )
  ).toBe(403);
  expect(
    await responseStatus(
      post("/api/v1/sessions/revoke", { sessionId: first.id }, headers)
    )
  ).toBe(200);
  expect(
    await responseStatus(fetch(`${origin}/api/v1/sessions`, { headers }))
  ).toBe(401);
  expect(
    await responseStatus(post("/api/v1/sessions/revoke-others", {}, headers))
  ).toBe(401);
}, 30_000);
