// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- These deployment transitions and readiness polls intentionally run sequentially.
import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import path from "node:path";

import { librarySchema } from "@pr0/api-contract/accounts";

import {
  cookieFrom,
  ingressHeaders,
  origin,
  password,
  post,
  verificationLink,
} from "./http-fixture";

const root = path.resolve(import.meta.dir, "../../..");
const project = `pr0-account-acceptance-${crypto.randomUUID().slice(0, 8)}`;
const compose = [
  "docker",
  "compose",
  "--project-name",
  project,
  "--env-file",
  "apps/web/tests/compose.env",
  "-f",
  "compose.yaml",
  "-f",
  "apps/web/tests/compose.yaml",
];
const run = async (
  command: string[],
  extraEnv: Record<string, string> = {}
) => {
  const child = Bun.spawn(command, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `Validation command failed (${code}): ${stdout}\n${stderr}`
    );
  }
  return stdout;
};
const dc = (args: string[], env?: Record<string, string>) =>
  run([...compose, ...args], env);
const ready = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/v1/ready`);
      if (response.ok) {
        return;
      }
    } catch {
      /* The container may still be starting. */
    }
    await Bun.sleep(500);
  }
  throw new Error("The production instance did not become ready");
};
const library = async (cookie: string) => {
  const response = await fetch(`${origin}/api/v1/library`, {
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  return librarySchema.parse(await response.json());
};
const signIn = async (email: string) => {
  const response = await post("/api/auth/sign-in/email", { email, password });
  expect(response.status).toBe(200);
  return cookieFrom(response);
};
// Clock/provenance fixture setup only. All assertions observe public HTTP outcomes.
const fixtureSQL = (statement: string) =>
  dc([
    "exec",
    "-T",
    "database",
    "psql",
    "-U",
    "pr0",
    "-d",
    "pr0",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    statement,
  ]);

test("production Compose completes closed admission, verified access, failure recovery, and durable restart", async () => {
  try {
    await dc(["up", "-d", "--no-build", "database", "smtp"]);
    await dc(["run", "--rm", "accounts", "migrate"]);
    await dc(["run", "--rm", "accounts", "migrate"]);
    await dc(["up", "-d", "--no-build", "web", "mail"]);
    await ready();
    const firstEmail = `first-${crypto.randomUUID()}@example.test`;
    const denied = await post("/api/auth/sign-up/email", {
      email: firstEmail,
      password,
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "registration_closed" });
    await dc(["run", "--rm", "accounts", "admit-first", firstEmail]);

    // A durable outbox survives application/database recreation before delivery.
    await dc(["stop", "mail"]);
    const signup = await post("/api/auth/sign-up/email", {
      email: firstEmail,
      password,
    });
    expect(signup.status).toBe(202);
    const unverified = await post("/api/auth/sign-in/email", {
      email: firstEmail,
      password,
    });
    expect(unverified.status).toBe(401);
    await dc(["stop", "web", "database"]);
    await dc([
      "up",
      "-d",
      "--no-build",
      "--force-recreate",
      "database",
      "web",
      "mail",
    ]);
    await ready();
    const link = await verificationLink(firstEmail);
    const expiredUrl = new URL(link);
    const token = expiredUrl.searchParams.get("token") ?? "";
    const [header, payload] = token.split(".");
    const expiredPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload ?? "", "base64url").toString()),
        exp: 1,
      })
    ).toString("base64url");
    const signed = `${header}.${expiredPayload}`;
    const signature = createHmac(
      "sha256",
      "local-account-integration-auth-secret-at-least-32-characters"
    )
      .update(signed)
      .digest("base64url");
    expiredUrl.searchParams.set("token", `${signed}.${signature}`);
    const expired = await fetch(expiredUrl, {
      redirect: "manual",
      headers: ingressHeaders(),
    });
    expect(expired.headers.get("location")).toBe(
      `${origin}/?verification=invalid`
    );
    const verify = await fetch(link, {
      redirect: "manual",
      headers: ingressHeaders(),
    });
    expect(verify.headers.get("location")).toBe(`${origin}/?verified=1`);
    let cookie = await signIn(firstEmail);
    const before = await library(cookie);
    await dc(["stop", "web", "mail", "database"]);
    await dc([
      "up",
      "-d",
      "--no-build",
      "--force-recreate",
      "database",
      "web",
      "mail",
    ]);
    await ready();
    const after = await library(cookie);
    expect(after.account).toEqual(before.account);
    expect(after.instance).toEqual(before.instance);
    expect(after.session.id).toBe(before.session.id);
    expect(after.prompts).toEqual([]);

    await fixtureSQL(
      `UPDATE session SET expires_at = now() + interval '2 days' WHERE id = '${after.session.id}'`
    );
    const renewed = await library(cookie);
    expect(Date.parse(renewed.session.expiresAt) - Date.now()).toBeGreaterThan(
      29 * 24 * 60 * 60 * 1000
    );
    await fixtureSQL(
      `UPDATE session SET provenance = 'device' WHERE id = '${after.session.id}'`
    );
    const copiedDevice = await fetch(`${origin}/api/v1/library`, {
      headers: { Cookie: cookie },
    });
    expect(copiedDevice.status).toBe(403);
    await fixtureSQL(
      `UPDATE session SET provenance = 'browser', expires_at = now() - interval '1 second' WHERE id = '${after.session.id}'`
    );
    const expiredSession = await fetch(`${origin}/api/v1/library`, {
      headers: { Cookie: cookie },
    });
    expect(expiredSession.status).toBe(401);
    cookie = await signIn(firstEmail);
    await fixtureSQL(
      `UPDATE "user" SET email_verified = false WHERE id = '${after.account.id}'`
    );
    const directUnverified = await fetch(`${origin}/api/v1/library`, {
      headers: { Cookie: cookie },
    });
    expect(directUnverified.status).toBe(403);
    expect(await directUnverified.json()).toEqual({ code: "email_unverified" });
    await fixtureSQL(
      `UPDATE "user" SET email_verified = true WHERE id = '${after.account.id}'`
    );

    const allowedEmail = `allowed-${crypto.randomUUID()}@example.test`;
    const allowlist = { PR0_REGISTRATION: "allowlist" };
    await dc(["run", "--rm", "accounts", "allow", allowedEmail], allowlist);
    await dc(["up", "-d", "--no-build", "--force-recreate", "web"], {
      PR0_REGISTRATION: "closed",
    });
    await ready();
    const closedAgain = await post("/api/auth/sign-up/email", {
      email: allowedEmail,
      password,
    });
    expect(closedAgain.status).toBe(403);
    await dc(["up", "-d", "--no-build", "--force-recreate", "web"], allowlist);
    await ready();
    const notAllowed = await post("/api/auth/sign-up/email", {
      email: `closed-${crypto.randomUUID()}@example.test`,
      password,
    });
    expect(notAllowed.status).toBe(403);
    await dc(["stop", "smtp"]);
    const accepted = await post("/api/auth/sign-up/email", {
      email: allowedEmail,
      password,
    });
    expect(accepted.status).toBe(202);
    await Bun.sleep(2000);
    const duringOutage = await post("/api/auth/sign-in/email", {
      email: allowedEmail,
      password,
    });
    expect(duringOutage.status).toBe(401);
    await dc(["start", "smtp"]);
    // Delivery retry has a bounded 30-second backoff; it must not verify by itself.
    await Bun.sleep(30_000);
    const recoveredLink = await verificationLink(allowedEmail);
    expect(recoveredLink.startsWith(origin)).toBe(true);
    const afterDelivery = await post("/api/auth/sign-in/email", {
      email: allowedEmail,
      password,
    });
    expect(afterDelivery.status).toBe(401);

    const open = { PR0_REGISTRATION: "open" };
    await dc(["up", "-d", "--no-build", "--force-recreate", "web"], open);
    await ready();
    const output = await run(
      ["bun", "test", "apps/web/tests/accounts-integration.test.ts"],
      { ...open, PR0_TEST_ORIGIN: origin }
    );
    process.stdout.write(output);

    // Fill only the controlled outbox capacity; compare both account populations.
    await dc(["stop", "mail"]);
    await fixtureSQL(
      "INSERT INTO mail_job(id, expires_at) SELECT gen_random_uuid(), now() + interval '1 hour' FROM generate_series(1, 1000)"
    );
    const unknownEmail = `unknown-${crypto.randomUUID()}@example.test`;
    for (const address of [firstEmail, unknownEmail]) {
      const fullSignup = await post("/api/auth/sign-up/email", {
        email: address,
        password,
      });
      expect(fullSignup.status).toBe(503);
      expect(await fullSignup.json()).toEqual({
        code: "unavailable",
        retryAfter: 30,
      });
    }
    for (const address of [allowedEmail, unknownEmail]) {
      const fullResend = await post("/api/auth/send-verification-email", {
        email: address,
      });
      expect(fullResend.status).toBe(503);
    }
    await fixtureSQL(
      "DELETE FROM mail_job WHERE payload IS NULL AND state = 'pending'"
    );
    await fixtureSQL("TRUNCATE admission_bucket");
    await dc(["up", "-d", "--no-build", "--force-recreate", "web"], {
      ...open,
      PR0_MAIL_SECRET: "invalid",
    });
    for (const address of [firstEmail, unknownEmail]) {
      const invalidConfig = await post("/api/auth/sign-up/email", {
        email: address,
        password,
      });
      expect(invalidConfig.status).toBe(503);
    }
    await dc(["up", "-d", "--no-build", "--force-recreate", "web"], open);
    await dc(["start", "mail"]);
    await ready();

    // A stalled authentication query occupies global work capacity until bounded cancellation.
    const lock = run([
      ...compose,
      "exec",
      "-T",
      "database",
      "psql",
      "-U",
      "pr0",
      "-d",
      "pr0",
      "-c",
      "BEGIN; LOCK TABLE session IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(8); COMMIT;",
    ]);
    await Bun.sleep(500);
    const blocked = Array.from({ length: 16 }, () =>
      fetch(`${origin}/api/v1/library`, { headers: { Cookie: cookie } })
    );
    await Bun.sleep(500);
    const queuedAt = Date.now();
    const queued = await fetch(`${origin}/api/v1/library`);
    expect(Date.now() - queuedAt).toBeGreaterThan(1500);
    expect([401, 503]).toContain(queued.status);
    await Promise.all(blocked);
    await lock;
    const afterStall = await library(cookie);
    expect(afterStall.account.id).toBe(before.account.id);

    // Exercise Secure cookies and canonical-link provenance behind an HTTPS origin.
    const secureOrigin = "https://accounts.example.test";
    await dc(["up", "-d", "--no-build", "--force-recreate", "web"], {
      ...open,
      PR0_ORIGIN: secureOrigin,
      SMTP_TLS: "starttls",
    });
    await ready();
    const secureLogin = await post(
      "/api/auth/sign-in/email",
      { email: firstEmail, password },
      { Origin: secureOrigin, "X-Forwarded-Host": "evil.example" }
    );
    expect(secureLogin.status).toBe(200);
    expect(secureLogin.headers.get("set-cookie")).toContain("Secure");
    expect(secureLogin.headers.get("set-cookie")).toContain(
      "__Secure-better-auth.session_token"
    );
    const secureLibrary = await library(cookieFrom(secureLogin));
    expect(secureLibrary.instance.origin).toBe(secureOrigin);
    expect(secureLibrary.instance.id).toBe(before.instance.id);
    const user = await dc(["exec", "-T", "web", "id", "-u"]);
    expect(user.trim()).not.toBe("0");
    process.stdout.write(
      "PASS production signup, SMTP recovery, account isolation, session expiry/provenance, secure cookies, migrations, and container recreation.\n"
    );
  } finally {
    // Only this test's randomly named, newly created project is removed.
    await dc(["down", "--volumes"]);
  }
}, 180_000);
