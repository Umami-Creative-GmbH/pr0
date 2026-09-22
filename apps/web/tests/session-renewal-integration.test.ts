import { expect, test } from "bun:test";

import { SQL } from "bun";

import { socialBrowser } from "./email-change-fixture";
import { ingressHeaders, origin } from "./http-fixture";

test("an active session renews its thirty-day inactivity expiry without rewriting browser cookies", async () => {
  const account = await socialBrowser();
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  try {
    // Arrange an almost-expired session; observe renewal through the public API.
    await sql`UPDATE session SET expires_at = now() + interval '5 minutes' WHERE id = ${account.sessionId}`;
  } finally {
    await sql.close();
  }
  const response = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: account.Cookie, ...ingressHeaders() },
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.account.id).toBe(account.identity.accountId);
  expect(body.session.id).toBe(account.sessionId);
  expect(Date.parse(body.session.expiresAt) - Date.now()).toBeGreaterThan(
    29 * 24 * 60 * 60 * 1000
  );
  expect(response.headers.getSetCookie()).toEqual([]);
  const sessions = await fetch(`${origin}/api/v1/sessions`, {
    headers: { Cookie: account.Cookie, ...ingressHeaders() },
  });
  expect(sessions.status).toBe(200);
  const list = await sessions.json();
  expect(Date.parse(list.sessions[0].expiresAt) - Date.now()).toBeGreaterThan(
    29 * 24 * 60 * 60 * 1000
  );
  expect(sessions.headers.getSetCookie()).toEqual([]);
});
