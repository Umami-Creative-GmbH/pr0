import { afterAll, expect, test } from "bun:test";

import { auth, client } from "./auth";

const origin = "http://localhost:30413";
const lifetime = 30 * 24 * 60 * 60 * 1000;
const request = async (
  path: string,
  body?: Record<string, string>,
  headers: Record<string, string> = {}
) => {
  const response = await auth.handler(
    new Request(`${origin}/api/auth${path}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", origin, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
};
const signup = async (suffix: string) => {
  const result = await request("/sign-up/email", {
    name: "Research user",
    email: `${suffix}@example.test`,
    password: "Research-password-only-13",
  });
  if (result.status !== 200) {
    throw new Error(`Research setup failed: ${result.status}`);
  }
  const cookies = result.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  return {
    token: result.body.token,
    userId: result.body.user.id,
    headers: { cookie: cookies },
  };
};
const issue = async () => {
  const result = await request("/device/code", { client_id: "pr0-desktop" });
  if (result.status !== 200) {
    throw new Error(`Research setup failed: ${result.status}`);
  }
  return result.body;
};
const approve = async (
  code: Record<string, string>,
  browser: Awaited<ReturnType<typeof signup>>
) => {
  const result1 = await request(
    `/device?user_code=${code.user_code}`,
    undefined,
    browser.headers
  );
  if (result1.status !== 200) {
    throw new Error(`Code verification failed: ${result1.status}`);
  }
  const result2 = await request(
    "/device/approve",
    { userCode: code.user_code },
    browser.headers
  );
  if (result2.status !== 200) {
    throw new Error(`Code approval failed: ${result2.status}`);
  }
};
const redeem = (code: Record<string, string>) =>
  request("/device/token", {
    client_id: "pr0-desktop",
    device_code: code.device_code,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
afterAll(async () => {
  await client.close();
});
test("migration and adapter account CRUD / transaction commit and rollback", async () => {
  const context = await auth.$context;
  const account = await signup(`crud-${crypto.randomUUID()}`);
  const accounts = await context.adapter.findMany({
    model: "account",
    where: [{ field: "userId", value: account.userId }],
  });
  expect(accounts).toHaveLength(1);
  await context.adapter.update({
    model: "user",
    where: [{ field: "id", value: account.userId }],
    update: { name: "Updated" },
  });
  const result3 = await context.adapter.findOne({
    model: "user",
    where: [{ field: "id", value: account.userId }],
  });
  expect(result3.name).toBe("Updated");
  await expect(
    context.adapter.transaction(async (tx) => {
      await tx.update({
        model: "user",
        where: [{ field: "id", value: account.userId }],
        update: { name: "Rolled back" },
      });
      await tx.deleteMany({
        model: "account",
        where: [{ field: "userId", value: account.userId }],
      });
      throw new Error("deliberate rollback");
    })
  ).rejects.toThrow("deliberate rollback");
  const result4 = await context.adapter.findOne({
    model: "user",
    where: [{ field: "id", value: account.userId }],
  });
  expect(result4.name).toBe("Updated");
  expect(
    await context.adapter.findMany({
      model: "account",
      where: [{ field: "userId", value: account.userId }],
    })
  ).toHaveLength(1);
  await context.adapter.transaction(async (tx) => {
    await tx.update({
      model: "account",
      where: [{ field: "userId", value: account.userId }],
      update: { scope: "validated" },
    });
  });
  const result5 = await context.adapter.findOne({
    model: "account",
    where: [{ field: "userId", value: account.userId }],
  });
  expect(result5.scope).toBe("validated");
  await context.adapter.delete({
    model: "user",
    where: [{ field: "id", value: account.userId }],
  });
  expect(
    await context.adapter.findOne({
      model: "user",
      where: [{ field: "id", value: account.userId }],
    })
  ).toBeNull();
  expect(
    await context.adapter.findMany({
      model: "account",
      where: [{ field: "userId", value: account.userId }],
    })
  ).toHaveLength(0);
  expect(
    await context.adapter.findMany({
      model: "session",
      where: [{ field: "userId", value: account.userId }],
    })
  ).toHaveLength(0);
});
test("browser approval gives independent bearer session; renewal, expiry and revocation", async () => {
  const browser = await signup(`sessions-${crypto.randomUUID()}`);
  const code = await issue();
  await approve(code, browser);
  const result = await redeem(code);
  if (result.status !== 200) {
    throw new Error(`Research setup failed: ${result.status}`);
  }
  const token = result.body.access_token;
  expect(token).not.toBe(browser.token);
  const bearerHeaders = { authorization: `Bearer ${token}` };
  const session = await request("/get-session", undefined, bearerHeaders);
  expect(session.body.user.id).toBe(browser.userId);
  const result6 = await request("/get-session", undefined, browser.headers);
  expect(session.body.session.id).not.toBe(result6.body.session.id);
  const oldExpiry = new Date(Date.now() + 86_400_000);
  await client`update session set expires_at = ${oldExpiry}, updated_at = ${new Date(Date.now() - lifetime + 86_400_000)} where token = ${token}`;
  const before = Date.now();
  const renewed = await request("/get-session", undefined, bearerHeaders);
  expect(renewed.status).toBe(200);
  const stored =
    await client`select expires_at from session where token = ${token}`;
  expect(new Date(stored[0].expires_at).getTime()).toBeGreaterThanOrEqual(
    before + lifetime - 2000
  );
  expect(new Date(renewed.body.session.expiresAt).getTime()).toBeGreaterThan(
    oldExpiry.getTime()
  );
  const result7 = await request("/revoke-session", { token }, browser.headers);
  expect(result7.status).toBe(200);
  const result8 = await request("/get-session", undefined, bearerHeaders);
  expect(result8.body).toBeNull();
  const result9 = await request("/get-session", undefined, browser.headers);
  expect(result9.body.user.id).toBe(browser.userId);
  const second = await issue();
  await approve(second, browser);
  const result10 = await redeem(second);
  const secondToken = result10.body.access_token;
  await client`update session set expires_at = ${new Date(Date.now() - 1000)} where token = ${secondToken}`;
  const result11 = await request("/get-session", undefined, {
    authorization: `Bearer ${secondToken}`,
  });
  expect(result11.body).toBeNull();
});
test("concurrent one-use redemption across 5 independent codes, 20 calls each", async () => {
  const browser = await signup(`race-${crypto.randomUUID()}`);
  /* oxlint-disable no-await-in-loop -- Each race needs an isolated before/after session count. */
  for (let round = 0; round < 5; round += 1) {
    const code = await issue();
    await approve(code, browser);
    const before =
      await client`select count(*)::int as count from session where user_id = ${browser.userId}`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => redeem(code))
    );
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    for (const result of results.filter(
      (response) => response.status !== 200
    )) {
      expect(["invalid_grant", "slow_down"]).toContain(result.body.error);
    }
    const after =
      await client`select count(*)::int as count from session where user_id = ${browser.userId}`;
    expect(after[0].count - before[0].count).toBe(1);
    const result12 = await redeem(code);
    expect(result12.status).not.toBe(200);
  }
});
test("pending, denial, expiry, invalid client, and different-browser approval fail closed", async () => {
  const browser = await signup(`negative-${crypto.randomUUID()}`);
  const otherBrowser = await signup(`other-${crypto.randomUUID()}`);
  const pending = await issue();
  const result13 = await redeem(pending);
  expect(result13.body.error).toBe("authorization_pending");
  const denied = await issue();
  const result14 = await request(
    `/device?user_code=${denied.user_code}`,
    undefined,
    browser.headers
  );
  expect(result14.status).toBe(200);
  const result15 = await request(
    "/device/approve",
    { userCode: denied.user_code },
    otherBrowser.headers
  );
  expect(result15.status).not.toBe(200);
  const result16 = await request(
    "/device/deny",
    { userCode: denied.user_code },
    browser.headers
  );
  expect(result16.status).toBe(200);
  const result17 = await redeem(denied);
  expect(result17.body.error).toBe("access_denied");
  const expired = await issue();
  await client`update device_code set expires_at = ${new Date(Date.now() - 1000)} where device_code = ${expired.device_code}`;
  const result18 = await redeem(expired);
  expect(result18.body.error).toBe("expired_token");
  const result19 = await request("/device/code", { client_id: "unknown" });
  expect(result19.status).not.toBe(200);
});

test("freshAge measures session creation, so stale-browser device approval is not reauthentication", async () => {
  const browser = await signup(`freshness-${crypto.randomUUID()}`);
  const context = await auth.$context;
  const linkedAccount = await context.adapter.create({
    model: "account",
    data: {
      accountId: crypto.randomUUID(),
      providerId: "research-provider",
      userId: browser.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const oldCreatedAt = new Date(Date.now() - 11 * 60 * 1000);
  await client`update session set created_at = ${oldCreatedAt} where token = ${browser.token}`;
  const browserUse = await request("/get-session", undefined, browser.headers);
  expect(browserUse.status).toBe(200);
  expect(new Date(browserUse.body.session.createdAt).getTime()).toBe(
    oldCreatedAt.getTime()
  );
  const staleSensitive = await request(
    "/unlink-account",
    { accountId: linkedAccount.id },
    browser.headers
  );
  expect(staleSensitive.status).toBe(403);
  expect(staleSensitive.body.code).toBe("SESSION_NOT_FRESH");
  const code = await issue();
  await approve(code, browser);
  const device = await redeem(code);
  expect(device.status).toBe(200);
  const headers = { authorization: `Bearer ${device.body.access_token}` };
  const deviceSensitive = await request(
    "/unlink-account",
    { accountId: linkedAccount.id },
    headers
  );
  expect(deviceSensitive.status).toBe(200);
  const firstUse = await request("/get-session", undefined, headers);
  const copiedTokenUse = await request("/get-session", undefined, {
    ...headers,
  });
  expect(copiedTokenUse.body.session.id).toBe(firstUse.body.session.id);
  expect(copiedTokenUse.body.session.token).toBe(device.body.access_token);
  const invalidToken = await request("/get-session", undefined, {
    authorization: "Bearer invalid-research-token",
  });
  expect(invalidToken.body).toBeNull();
});
