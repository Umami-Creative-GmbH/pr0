// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Controlled clock and deployment transitions are sequential acceptance steps.
import { expect, test } from "bun:test";
import path from "node:path";

import { librarySchema, sessionsSchema } from "@pr0/api-contract/accounts";

import {
  cookieFrom,
  origin,
  password,
  post,
  accountEmailLink,
} from "./http-fixture";

const root = path.resolve(import.meta.dir, "../../..");
const project = `pr0-recovery-acceptance-${crypto.randomUUID().slice(0, 8)}`;
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
  "-f",
  "apps/web/tests/recovery-compose.yaml",
];
const run = async (
  command: string[],
  extraEnv: Record<string, string> = {}
) => {
  const child = Bun.spawn(command, {
    cwd: root,
    env: { ...process.env, PR0_REGISTRATION: "open", ...extraEnv },
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

const advanceDays = (days: number) =>
  dc([
    "exec",
    "-T",
    "web",
    "bun",
    "-e",
    `await Bun.write('/tmp/pr0-test-clock', '${days * 86_400_000}');`,
  ]);
const requestStatus = async (response: Promise<Response>) => {
  const result = await response;
  return result.status;
};
const recoverToken = async (email: string) => {
  const requested = await post("/api/auth/request-password-reset", { email });
  if (requested.status !== 202) {
    throw new Error("Recovery fixture could not request an email");
  }
  const link = await accountEmailLink(email, "Reset your pr0 password");
  return new URLSearchParams(new URL(link).hash.slice(1)).get("token");
};

test("an overlapping old-password login cannot create surviving access after recovery", async () => {
  try {
    await dc(["up", "-d", "--no-build", "database", "smtp"]);
    await dc(["run", "--rm", "accounts", "migrate"]);
    await dc(["up", "-d", "--no-build", "web", "mail"]);
    await ready();
    const email = `overlap-${crypto.randomUUID()}@example.test`;
    await post("/api/auth/sign-up/email", { email, password });
    await fetch(await accountEmailLink(email), { redirect: "manual" });
    const token = await recoverToken(email);
    // A test-only database barrier pauses issuance after real password verification.
    await fixtureSQL(
      "CREATE FUNCTION pause_test_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(25025); RETURN NEW; END; $$; CREATE TRIGGER aa_test_pause_session BEFORE INSERT ON session FOR EACH ROW EXECUTE FUNCTION pause_test_session();"
    );
    const blocker = fixtureSQL(
      "BEGIN; SELECT pg_advisory_xact_lock(25025); SELECT pg_sleep(3); COMMIT;"
    );
    await Bun.sleep(200);
    const signingIn = post("/api/auth/sign-in/email", { email, password });
    let paused = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const locks = await fixtureSQL(
        "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 25025 AND NOT granted"
      );
      if (/\n\s+1\s*\n/u.test(locks)) {
        paused = true;
        break;
      }
      await Bun.sleep(100);
    }
    expect(paused).toBe(true);
    const reset = await post("/api/auth/reset-password", {
      token,
      newPassword: "overlap-replacement-password",
    });
    expect(reset.status).toBe(200);
    await blocker;
    const login = await signingIn;
    const access = await fetch(`${origin}/api/v1/library`, {
      headers: { Cookie: cookieFrom(login) },
    });
    expect(access.status).toBe(401);
    const fresh = await post("/api/auth/sign-in/email", {
      email,
      password: "overlap-replacement-password",
    });
    expect(fresh.status).toBe(200);
  } finally {
    await dc(["down", "--volumes"]);
  }
}, 60_000);

test("production recovery survives delivery failures, token races, social-only recovery, and thirty-day inactivity", async () => {
  try {
    await dc(["up", "-d", "--no-build", "database", "smtp"]);
    await dc(["run", "--rm", "accounts", "migrate"]);
    await dc(["up", "-d", "--no-build", "web", "mail"]);
    await ready();
    process.stdout.write(
      await run(["bun", "test", "apps/web/tests/recovery-integration.test.ts"])
    );

    const email = `clock-${crypto.randomUUID()}@example.test`;
    await post("/api/auth/sign-up/email", { email, password });
    await fetch(await accountEmailLink(email), { redirect: "manual" });
    const active = await signIn(email);
    const inactive = await signIn(email);
    const identity = await library(active);
    await advanceDays(29);
    const renewed = await library(active);
    expect(Date.parse(renewed.session.expiresAt) - Date.now()).toBeGreaterThan(
      58 * 86_400_000
    );
    await advanceDays(31);
    expect(
      await requestStatus(
        fetch(`${origin}/api/v1/library`, { headers: { Cookie: inactive } })
      )
    ).toBe(401);
    expect(
      await requestStatus(
        fetch(`${origin}/api/v1/sessions`, { headers: { Cookie: inactive } })
      )
    ).toBe(401);
    expect(
      await requestStatus(
        post("/api/v1/sessions/revoke-others", {}, { Cookie: inactive })
      )
    ).toBe(401);
    const stillActive = await library(active);
    expect(stillActive.account.id).toBe(identity.account.id);
    await advanceDays(62);
    expect(
      await requestStatus(
        fetch(`${origin}/api/v1/library`, { headers: { Cookie: active } })
      )
    ).toBe(401);
    await advanceDays(0);

    // A verified social-only account is fixture setup, not an OAuth integration claim.
    await fixtureSQL(
      `UPDATE account SET provider_id = 'github', password = NULL WHERE user_id = '${identity.account.id}'`
    );
    const token = await recoverToken(email);
    const newPassword = "social-account-recovered-password";
    const raced = await Promise.all([
      post("/api/auth/reset-password", { token, newPassword }),
      post("/api/auth/reset-password", { token, newPassword }),
    ]);
    expect(new Set(raced.map((response) => response.status))).toEqual(
      new Set([200, 400])
    );
    const recovered = await post("/api/auth/sign-in/email", {
      email,
      password: newPassword,
    });
    expect(recovered.status).toBe(200);
    const afterRecovery = await library(cookieFrom(recovered));
    expect(afterRecovery.account.id).toBe(identity.account.id);

    const expiredEmail = `expired-${crypto.randomUUID()}@example.test`;
    await post("/api/auth/sign-up/email", { email: expiredEmail, password });
    await fetch(await accountEmailLink(expiredEmail), { redirect: "manual" });
    const expiredCookie = await signIn(expiredEmail);
    const expiredIdentity = await library(expiredCookie);
    const expiredToken = await recoverToken(expiredEmail);
    await fixtureSQL(
      `UPDATE verification SET expires_at = now() - interval '1 second' WHERE value = '${expiredIdentity.account.id}'`
    );
    expect(
      await requestStatus(
        post("/api/auth/reset-password", { token: expiredToken, newPassword })
      )
    ).toBe(400);
    expect(
      await requestStatus(
        post("/api/auth/sign-in/email", { email: expiredEmail, password })
      )
    ).toBe(200);
    expect(
      await requestStatus(
        fetch(`${origin}/api/v1/library`, {
          headers: { Cookie: expiredCookie },
        })
      )
    ).toBe(200);

    // Only adjust transport fixtures; observe terminal failure through the operator interface.
    await dc(["stop", "smtp", "mail"]);
    const queued = await post("/api/auth/request-password-reset", {
      email: expiredEmail,
    });
    expect(queued.status).toBe(202);
    await fixtureSQL(
      "UPDATE mail_job SET attempts = 4, next_attempt_at = now() WHERE state = 'pending'"
    );
    await dc(["start", "mail"]);
    let status = "";
    for (let attempt = 0; attempt < 15; attempt += 1) {
      status = await dc(["run", "--rm", "accounts", "mail-status"]);
      if (status.includes('"failed"')) {
        break;
      }
      await Bun.sleep(1000);
    }
    expect(status).toContain('"failed"');
    expect(
      await requestStatus(
        post("/api/auth/sign-in/email", { email: expiredEmail, password })
      )
    ).toBe(200);
    const logs = await dc(["logs", "--no-color", "mail"]);
    expect(logs).toContain('"terminal":true');
    expect(logs).not.toContain(expiredEmail);
    expect(logs).not.toContain("#token=");
    expect(logs).not.toContain(password);
    await dc(["start", "smtp"]);
    await ready();

    // A queued recovery message retains its token across container recreation.
    await fixtureSQL("TRUNCATE admission_bucket");
    await dc(["stop", "mail"]);
    expect(
      await requestStatus(
        post("/api/auth/request-password-reset", { email: expiredEmail })
      )
    ).toBe(202);
    await dc(["restart", "web", "database"]);
    await dc(["start", "mail"]);
    await ready();
    // The latest recovery delivery is selected rather than the earlier expired message.
    const durableLink = await accountEmailLink(
      expiredEmail,
      "Reset your pr0 password",
      expiredToken ?? undefined
    );
    const durableToken = new URLSearchParams(
      new URL(durableLink).hash.slice(1)
    ).get("token");
    expect(durableToken).not.toBe(expiredToken);
    expect(
      await requestStatus(
        post("/api/auth/reset-password", { token: durableToken, newPassword })
      )
    ).toBe(200);
    expect(
      await requestStatus(
        fetch(`${origin}/api/v1/library`, {
          headers: { Cookie: expiredCookie },
        })
      )
    ).toBe(401);
    const finalLogin = await post("/api/auth/sign-in/email", {
      email: expiredEmail,
      password: newPassword,
    });
    const list = await fetch(`${origin}/api/v1/sessions`, {
      headers: { Cookie: cookieFrom(finalLogin) },
    });
    expect(sessionsSchema.parse(await list.json()).sessions).toHaveLength(1);
  } finally {
    await dc(["down", "--volumes"]);
  }
}, 180_000);
