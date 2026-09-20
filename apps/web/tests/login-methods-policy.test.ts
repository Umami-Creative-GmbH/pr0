import { expect, test } from "bun:test";

import { accountIdentitySchema } from "@pr0/api-contract/accounts";

import { origin, post } from "./http-fixture";
import { methodsFor, startLink } from "./login-methods-fixture";

const browser = {
  Cookie: process.env.PR0_TEST_METHOD_COOKIE ?? "",
  identity: accountIdentitySchema.parse({
    accountId: process.env.PR0_TEST_METHOD_ACCOUNT,
    emailVersion: 0,
  }),
};
if (process.env.PR0_TEST_METHOD_POLICY === "closed") {
  test("registration closure still permits an existing account to explicitly link", async () => {
    const link = await startLink(browser);
    const result = await link.complete(
      crypto.randomUUID(),
      "closed-link@example.test"
    );
    expect(result.headers.get("location")).toBe(`${origin}/?methods=linked`);
    const methods = await methodsFor(browser.Cookie);
    expect(methods.methods).toHaveLength(2);
  });
} else {
  test("a disabled provider is not a usable alternative to the remaining login", async () => {
    const methods = await methodsFor(browser.Cookie);
    expect(methods.providers).toEqual(["github"]);
    const google = methods.methods.find(
      (method) => method.provider === "google"
    );
    const github = methods.methods.find(
      (method) => method.provider === "github"
    );
    expect(google?.usable).toBe(false);
    expect(github?.usable).toBe(true);
    const refused = await post(
      "/api/v1/account/methods/remove",
      { ...browser.identity, methodId: github?.id },
      { Cookie: browser.Cookie }
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ code: "last_login_method" });
    const disabledStart = await post(
      "/api/v1/account/methods/link",
      { ...browser.identity, provider: "google" },
      { Cookie: browser.Cookie }
    );
    expect(disabledStart.status).toBe(404);
    const removed = await post(
      "/api/v1/account/methods/remove",
      { ...browser.identity, methodId: google?.id },
      { Cookie: browser.Cookie }
    );
    expect(removed.status).toBe(200);
  });
}
