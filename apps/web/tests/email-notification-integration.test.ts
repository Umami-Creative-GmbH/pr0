// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- SMTP outages and clock advancement are sequential external-effect fixtures.
import { expect, test } from "bun:test";

import { SQL } from "bun";

import { freshSocialBrowser, emailCode } from "./email-change-fixture";
import { origin, post } from "./http-fixture";
import { libraryFor } from "./social-fixture";

const smtp = async (command: "stop" | "start") => {
  const child = Bun.spawn(
    [
      "docker",
      "compose",
      "-p",
      "pr0-email-27",
      "-f",
      "apps/web/tests/social-compose.yaml",
      command,
      "smtp",
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  if ((await child.exited) !== 0) {
    throw new Error("Cannot control the isolated SMTP fixture");
  }
};

test("terminal old-address notification failure remains visible without rolling back the verified email", async () => {
  const browser = await freshSocialBrowser();
  const headers = { Cookie: browser.Cookie };
  const email = `${crypto.randomUUID()}@example.test`;
  const requested = await post(
    "/api/v1/account/email/challenges",
    { ...browser.identity, email },
    headers
  );
  const { challengeId } = await requested.json();
  const code = await emailCode(email);
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  try {
    await smtp("stop");
    const changed = await post(
      "/api/v1/account/email/verify",
      { ...browser.identity, challengeId, code },
      headers
    );
    expect(await changed.json()).toEqual({
      status: "email_changed",
      notification: "pending",
    });
    let notification = "pending";
    for (
      let attempt = 0;
      attempt < 20 && notification === "pending";
      attempt += 1
    ) {
      // Advance scheduled retry time only; the worker makes real failed SMTP attempts.
      await sql`UPDATE mail_job SET next_attempt_at = now() - interval '1 second'
        WHERE id IN (SELECT id FROM account_notice WHERE account_id = ${browser.identity.accountId})`;
      await Bun.sleep(1100);
      const settings = await fetch(`${origin}/api/v1/account`, { headers });
      ({ notification } = await settings.json());
    }
    expect(notification).toBe("failed");
    const library = await libraryFor(browser.Cookie);
    expect(library.account.email).toBe(email);
    // Age the delivery log past retention; the visible failure must survive cleanup.
    await sql`UPDATE mail_job SET completed_at = now() - interval '8 days'
      WHERE id IN (SELECT id FROM account_notice WHERE account_id = ${browser.identity.accountId})`;
    await Bun.sleep(1500);
    const retained = await fetch(`${origin}/api/v1/account`, { headers });
    expect(await retained.json()).toMatchObject({
      notification: "failed",
      email,
    });
  } finally {
    await sql.close();
    await smtp("start");
  }
}, 40_000);
