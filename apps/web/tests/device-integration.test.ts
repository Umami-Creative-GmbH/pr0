import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import {
  capabilitiesSchema,
  deviceCodeSchema,
  deviceTokenSchema,
  desktopSessionSchema,
} from "@pr0/api-contract/device";

import fixtures from "../../../packages/api-contract/src/device-fixtures.json";
import {
  approveDevice,
  readDesktop,
  redeem,
  startDevice,
  tokenFrom,
  verifiedBrowser,
} from "./device-fixture";
import { origin, post, cookieFrom } from "./http-fixture";
import { githubLogin } from "./social-fixture";

test("shared conformance responses are accepted by the public TypeScript validators", () => {
  expect(capabilitiesSchema.safeParse(fixtures.capabilities).success).toBe(
    true
  );
  expect(deviceCodeSchema.safeParse(fixtures.code).success).toBe(true);
  expect(deviceTokenSchema.safeParse(fixtures.token).success).toBe(true);
  expect(desktopSessionSchema.safeParse(fixtures.session).success).toBe(true);
});

test("explicit browser approval creates an independent desktop session", async () => {
  const { browser, library } = await verifiedBrowser();
  const code = await startDevice();
  const approval = await approveDevice(
    code.user_code,
    library.account.id,
    browser
  );
  expect({ status: approval.status, body: await approval.json() }).toEqual({
    status: 200,
    body: { success: true },
  });
  const token = await redeem(code.device_code);
  expect(token.status).toBe(200);
  expect(token.headers.has("set-cookie")).toBe(false);
  const credential = await tokenFrom(token);
  const headers = { Authorization: `Bearer ${credential.access_token}` };
  const desktop = await readDesktop(credential.access_token);
  expect(desktop.account.id).toBe(library.account.id);
  expect(desktop.session.id).not.toBe(library.session.id);
  expect(desktop.session.provenance).toBe("device");
  const logout = await post("/api/v1/desktop/sign-out", {}, headers);
  expect(logout.status).toBe(200);
  const expired = await fetch(`${origin}/api/v1/desktop/session`, { headers });
  expect(expired.status).toBe(401);
  const activeBrowser = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: browser },
  });
  expect(activeBrowser.status).toBe(200);
});

test("denial, cancellation, pending state and direct bypasses create no usable login", async () => {
  const { browser, library } = await verifiedBrowser();
  const pending = await startDevice();
  const firstPoll = await redeem(pending.device_code);
  expect(await firstPoll.json()).toEqual({ error: "authorization_pending" });
  const denied = await startDevice();
  const denial = await approveDevice(
    denied.user_code,
    library.account.id,
    browser,
    false
  );
  expect(denial.status).toBe(200);
  const rejected = await redeem(denied.device_code);
  expect(await rejected.json()).toEqual({ error: "access_denied" });
  const cancelled = await startDevice();
  await post("/api/auth/device/cancel", {
    client_id: "pr0-desktop",
    device_code: cancelled.device_code,
  });
  const afterCancel = await approveDevice(
    cancelled.user_code,
    library.account.id,
    browser
  );
  expect(afterCancel.status).toBe(400);
  const cancelledToken = await redeem(cancelled.device_code);
  expect(cancelledToken.status).toBe(400);
  const bypass = await fetch(
    `${origin}/api/auth/device?user_code=${pending.user_code}`,
    { headers: { Cookie: browser } }
  );
  expect(bypass.status).toBe(404);
  const forged = await post(
    "/api/auth/device/approve",
    { userCode: pending.user_code, accountId: library.account.id },
    { Cookie: browser, Origin: "https://evil.example" }
  );
  expect(forged.status).toBe(403);
  const browserStart = await post(
    "/api/auth/device/code",
    { client_id: "pr0-desktop" },
    { "Sec-Fetch-Site": "same-origin" }
  );
  expect(browserStart.status).toBe(403);
});

test("concurrent redemption and lost delivery leave one revocable session and a new-flow retry", async () => {
  const { browser, library } = await verifiedBrowser();
  const code = await startDevice();
  await approveDevice(code.user_code, library.account.id, browser);
  const results = await Promise.all([
    redeem(code.device_code),
    redeem(code.device_code),
  ]);
  expect(results.filter((result) => result.status === 200)).toHaveLength(1);
  expect(results.filter((result) => result.status === 400)).toHaveLength(1);
  const replay = await redeem(code.device_code);
  expect(replay.status).toBe(400);
  const list = await fetch(`${origin}/api/v1/sessions`, {
    headers: { Cookie: browser },
  });
  const sessions = await list.json();
  expect(
    sessions.sessions.filter(
      (session: { provenance: string }) => session.provenance === "device"
    )
  ).toHaveLength(1);
  const retry = await startDevice();
  expect(retry.device_code).not.toBe(code.device_code);
});

test("account switches and device credentials in cookies cannot approve or gain browser privileges", async () => {
  const first = await verifiedBrowser();
  const second = await verifiedBrowser();
  const code = await startDevice();
  const changed = await approveDevice(
    code.user_code,
    first.library.account.id,
    second.browser
  );
  expect(changed.status).toBe(409);
  const results = await Promise.all([
    approveDevice(code.user_code, first.library.account.id, first.browser),
    approveDevice(code.user_code, second.library.account.id, second.browser),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  const credential = await tokenFrom(await redeem(code.device_code));
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
    .update(credential.access_token)
    .digest("base64");
  const Cookie = `better-auth.session_token=${encodeURIComponent(`${credential.access_token}.${signature}`)}`;
  const another = await startDevice();
  const escalation = await approveDevice(
    another.user_code,
    first.library.account.id,
    Cookie
  );
  expect(escalation.status).toBe(403);
  const settings = await fetch(`${origin}/api/v1/sessions`, {
    headers: { Cookie },
  });
  expect(settings.status).toBe(403);
});

test("enabled social login approves through the identical browser path", async () => {
  const login = await githubLogin(
    crypto.randomUUID(),
    `${crypto.randomUUID()}@example.test`
  );
  const browser = cookieFrom(login);
  const response = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: browser },
  });
  const library = await response.json();
  const code = await startDevice();
  const approved = await approveDevice(
    code.user_code,
    library.account.id,
    browser
  );
  expect(approved.status).toBe(200);
  const credential = await tokenFrom(await redeem(code.device_code));
  const desktop = await readDesktop(credential.access_token);
  expect(desktop.account.id).toBe(library.account.id);
});
