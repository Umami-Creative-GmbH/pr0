import { expect, test } from "bun:test";

import {
  accountEmailLink,
  cookieFrom,
  ingressHeaders,
  origin,
  password,
  post,
} from "./http-fixture";
import { githubLogin, libraryFor, statusOf } from "./social-fixture";

const mode = process.env.PR0_TEST_SOCIAL_MODE;
if (mode === "closed" || mode === "allowlist") {
  test("registration policy covers provider callbacks and collected-email requests while returning identities survive restart", async () => {
    const denied = await githubLogin(
      crypto.randomUUID(),
      `${crypto.randomUUID()}@example.test`
    );
    expect(denied.headers.get("location")).toBe(
      `${origin}/?social=registration_closed`
    );
    const pending = await githubLogin(crypto.randomUUID());
    expect(
      await statusOf(
        post(
          "/api/auth/social/email",
          { email: `${crypto.randomUUID()}@example.test` },
          { Cookie: cookieFrom(pending) }
        )
      )
    ).toBe(403);
    const returned = await githubLogin(
      process.env.PR0_TEST_RETURNING_SUBJECT ?? "",
      "changed@example.test",
      false
    );
    expect(returned.headers.get("location")).toBe(`${origin}/`);
    const library = await libraryFor(cookieFrom(returned));
    expect(library.account.id).toBe(
      process.env.PR0_TEST_RETURNING_ACCOUNT ?? ""
    );
    expect(library.account.email).toBe(
      process.env.PR0_TEST_RETURNING_EMAIL ?? ""
    );
    const collision = await githubLogin(
      crypto.randomUUID(),
      library.account.email
    );
    expect(collision.headers.get("location")).toBe(
      `${origin}/?social=account_not_linked`
    );
    const pendingCollision = await githubLogin(crypto.randomUUID());
    const Cookie = cookieFrom(pendingCollision);
    const priorLink =
      mode === "allowlist"
        ? await accountEmailLink(library.account.email)
        : undefined;
    const priorToken = priorLink
      ? (new URLSearchParams(new URL(priorLink).hash.slice(1)).get("token") ??
        undefined)
      : undefined;
    expect(
      await statusOf(
        post(
          "/api/auth/social/email",
          { email: library.account.email },
          { Cookie }
        )
      )
    ).toBe(202);
    const link = await accountEmailLink(
      library.account.email,
      undefined,
      priorToken
    );
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
    const proof = await post("/api/auth/social/verify", { token }, { Cookie });
    expect(proof.status).toBe(400);
    expect(await proof.json()).toEqual({ code: "account_not_linked" });
    if (mode === "allowlist") {
      const allowed = await githubLogin(
        crypto.randomUUID(),
        "allowed-social@example.test"
      );
      expect(allowed.headers.get("location")).toBe(`${origin}/`);
    }
  });
}
if (mode === "closed") {
  test("registration admission is checked again after pending email verification", async () => {
    const response = await post(
      "/api/auth/social/verify",
      { token: process.env.PR0_TEST_PENDING_TOKEN },
      { Cookie: process.env.PR0_TEST_PENDING_COOKIE ?? "" }
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "registration_closed" });
  });
}
if (mode === "disabled") {
  test("disabled providers reject direct starts and callbacks while email/password remains usable", async () => {
    const providers = await fetch(`${origin}/api/auth/providers`, {
      headers: ingressHeaders(),
    });
    expect(await providers.json()).toEqual({ providers: [] });
    const attempts = await Promise.all(
      ["google", "github"].map(async (provider) => {
        const start = await post("/api/auth/sign-in/social", { provider });
        const callback = await fetch(
          `${origin}/api/auth/callback/${provider}?state=forged&code=forged`,
          { headers: ingressHeaders(), redirect: "manual" }
        );
        return [start.status, callback.status];
      })
    );
    expect(attempts).toEqual([
      [404, 404],
      [404, 404],
    ]);
    const email = `${crypto.randomUUID()}@example.test`;
    expect(
      await statusOf(post("/api/auth/sign-up/email", { email, password }))
    ).toBe(202);
    await fetch(await accountEmailLink(email), {
      headers: ingressHeaders(),
      redirect: "manual",
    });
    const login = await post("/api/auth/sign-in/email", { email, password });
    expect(login.status).toBe(200);
    const library = await libraryFor(cookieFrom(login));
    expect(library.account.email).toBe(email);
  }, 20_000);
}
