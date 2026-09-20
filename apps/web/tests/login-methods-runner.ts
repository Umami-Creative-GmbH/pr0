import { accountTestServer, runAcceptance } from "./account-test-server";
import { freshSocialBrowser } from "./email-change-fixture";

const fixture = accountTestServer("pr0-methods-28");
try {
  await fixture.setup();
  await runAcceptance([
    "bun",
    "test",
    "apps/web/tests/login-methods-integration.test.ts",
    "--timeout",
    "20000",
  ]);
  const browser = await freshSocialBrowser();
  const policy = {
    PR0_TEST_METHOD_COOKIE: browser.Cookie,
    PR0_TEST_METHOD_ACCOUNT: browser.identity.accountId,
  };
  await fixture.startServer({ PR0_REGISTRATION: "closed" });
  await runAcceptance(
    [
      "bun",
      "test",
      "apps/web/tests/login-methods-policy.test.ts",
      "--timeout",
      "20000",
    ],
    { ...policy, PR0_TEST_METHOD_POLICY: "closed" }
  );
  await fixture.startServer({ PR0_GOOGLE_CLIENT_ID: "" });
  await runAcceptance(
    [
      "bun",
      "test",
      "apps/web/tests/login-methods-policy.test.ts",
      "--timeout",
      "20000",
    ],
    { ...policy, PR0_TEST_METHOD_POLICY: "disabled" }
  );
} finally {
  await fixture.cleanup();
}
