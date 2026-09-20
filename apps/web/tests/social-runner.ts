import { SQL } from "bun";

import { accountTestServer, runAcceptance } from "./account-test-server";
import { accountEmailLink, cookieFrom, post } from "./http-fixture";
import { githubLogin, libraryFor } from "./social-fixture";

const serverFixture = accountTestServer("pr0-social-26");
try {
  await serverFixture.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/social-integration.test.ts",
    "--timeout",
    "20000",
  ]);
  const subject = crypto.randomUUID();
  const email = `${subject}@example.test`;
  const returning = await githubLogin(subject, email);
  const identity = await libraryFor(cookieFrom(returning));
  const pending = await githubLogin(crypto.randomUUID());
  const Cookie = cookieFrom(pending);
  const pendingEmail = `${crypto.randomUUID()}@example.test`;
  await post("/api/auth/social/email", { email: pendingEmail }, { Cookie });
  const link = await accountEmailLink(pendingEmail);
  const token =
    new URLSearchParams(new URL(link).hash.slice(1)).get("token") ?? "";
  const fixture = {
    PR0_TEST_RETURNING_SUBJECT: subject,
    PR0_TEST_RETURNING_EMAIL: email,
    PR0_TEST_RETURNING_ACCOUNT: identity.account.id,
    PR0_TEST_PENDING_COOKIE: Cookie,
    PR0_TEST_PENDING_TOKEN: token,
  };
  await serverFixture.startServer({ PR0_REGISTRATION: "closed" });
  await runAcceptance(
    [
      "bun",
      "test",
      "apps/web/tests/social-policy.test.ts",
      "--timeout",
      "20000",
    ],
    { ...fixture, PR0_TEST_SOCIAL_MODE: "closed" }
  );
  const sql = new SQL(process.env.DATABASE_URL ?? "");
  await sql`INSERT INTO registration_admission(email) VALUES ('allowed-social@example.test') ON CONFLICT DO NOTHING`;
  await sql.close();
  await serverFixture.startServer({ PR0_REGISTRATION: "allowlist" });
  await runAcceptance(
    [
      "bun",
      "test",
      "apps/web/tests/social-policy.test.ts",
      "--timeout",
      "20000",
    ],
    { ...fixture, PR0_TEST_SOCIAL_MODE: "allowlist" }
  );
  await serverFixture.startServer({
    PR0_GOOGLE_CLIENT_ID: "",
    PR0_GITHUB_CLIENT_ID: "",
  });
  await runAcceptance(
    [
      "bun",
      "test",
      "apps/web/tests/social-policy.test.ts",
      "--timeout",
      "20000",
    ],
    { PR0_TEST_SOCIAL_MODE: "disabled" }
  );
} finally {
  await serverFixture.cleanup();
}
