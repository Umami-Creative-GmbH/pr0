import { expect, test } from "bun:test";

import { SQL } from "bun";
import { chromium } from "playwright";

import { freshSocialBrowser, socialBrowser } from "./email-change-fixture";
import { ingressHeaders, origin } from "./http-fixture";
import { startLink } from "./login-methods-fixture";

test.each([
  { path: "/api/v1/library", method: "GET", expired: false, status: 200 },
  { path: "/api/v1/library", method: "GET", expired: true, status: 401 },
  { path: "/api/v1/sessions", method: "GET", expired: false, status: 200 },
  { path: "/api/auth/sign-out", method: "POST", expired: false, status: 200 },
  {
    path: "/api/auth/callback/google",
    method: "GET",
    expired: false,
    status: 303,
  },
])(
  "a late $method $path response (expired=$expired) cannot undo an account switch",
  async ({ path, method, expired, status }) => {
    const linking = path === "/api/auth/callback/google";
    const first = await (linking ? freshSocialBrowser() : socialBrowser());
    const link = linking ? await startLink(first) : undefined;
    const second = await socialBrowser();
    if (expired) {
      const sql = new SQL(process.env.DATABASE_URL ?? "");
      try {
        await sql`UPDATE session SET expires_at = now() - interval '1 second' WHERE id = ${first.sessionId}`;
      } finally {
        await sql.close();
      }
    }
    const browser = await chromium.launch({
      channel: process.env.PR0_BROWSER_CHANNEL ?? "chrome",
      headless: true,
    });
    const context = await browser.newContext({
      extraHTTPHeaders: ingressHeaders(),
    });
    const release = Promise.withResolvers<null>();
    const held = Promise.withResolvers<null>();
    try {
      const selectAccount = async (Cookie: string) => {
        await context.addCookies(
          Cookie.split("; ").map((cookie) => {
            const separator = cookie.indexOf("=");
            return {
              name: cookie.slice(0, separator),
              value: cookie.slice(separator + 1),
              url: origin,
            };
          })
        );
      };
      await selectAccount(link?.Cookie ?? first.Cookie);
      // Keep the document free of app polling so only the deliberately delayed
      // request participates in the race. Both tabs share the real browser jar.
      await context.route(`${origin}/session-race`, (route) =>
        route.fulfill({ contentType: "text/html", body: "Session race" })
      );
      const oldTab = await context.newPage();
      const newTab = await context.newPage();
      await oldTab.goto(`${origin}/session-race`);
      await newTab.goto(`${origin}/session-race`);
      await oldTab.route(`${origin}${path}`, async (route) => {
        // Bun fetch does not apply Set-Cookie to Playwright's shared cookie jar.
        // route.fetch would apply it before we release the response.
        const response = link
          ? await link.complete(crypto.randomUUID(), first.email)
          : await fetch(route.request().url(), {
              headers: await route.request().allHeaders(),
              method: route.request().method(),
              body: route.request().postData(),
            });
        const body = await response.text();
        expect(response.status).toBe(status);
        if (link) {
          expect(response.headers.get("location")).toBe(
            `${origin}/?methods=linked`
          );
        }
        held.resolve(null);
        await release.promise;
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body,
        });
      });
      const pending = oldTab.evaluate(
        async (request) => {
          const response = await fetch(request.path, {
            method: request.method,
            headers: { "Content-Type": "application/json" },
            body: request.method === "POST" ? "{}" : undefined,
            redirect: "manual",
          });
          return response.status;
        },
        { path, method }
      );
      await held.promise;
      // Complete an actual sign-in in the other tab while A's response is held.
      await newTab.evaluate(
        async ({ email, subject }) => {
          const start = await fetch("/api/auth/sign-in/social", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "github" }),
          });
          const { url } = await start.json();
          const state = new URL(url).searchParams.get("state");
          const code = btoa(
            JSON.stringify({ id: subject, email, verified: true })
          );
          await fetch(
            `/api/auth/callback/github?state=${state}&code=${encodeURIComponent(code)}`
          );
        },
        { email: second.email, subject: second.subject }
      );
      const currentAccount = () =>
        newTab.evaluate(async () => {
          const response = await fetch("/api/v1/library");
          const body = await response.json();
          return body.account?.id;
        });
      expect(await currentAccount()).toBe(second.identity.accountId);
      release.resolve(null);
      expect(await pending).toBe(linking ? 0 : status);
      expect(await currentAccount()).toBe(second.identity.accountId);
      const browserCookies = await context.cookies();
      const cookie = browserCookies.find((value) =>
        value.name.endsWith(".session_token")
      );
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe("Lax");
      expect((cookie?.expires ?? 0) - Date.now() / 1000).toBeGreaterThan(
        399 * 24 * 60 * 60
      );
    } finally {
      release.resolve(null);
      await browser.close();
    }
  },
  60_000
);
