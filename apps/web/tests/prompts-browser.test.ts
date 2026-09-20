import { expect, test } from "bun:test";

import { chromium } from "playwright";

import { origin } from "./http-fixture";
import { promptBrowser, promptOperation } from "./prompt-fixture";

const cookies = (Cookie: string) =>
  Cookie.split("; ").map((cookie) => {
    const split = cookie.indexOf("=");
    return {
      name: cookie.slice(0, split),
      value: cookie.slice(split + 1),
      url: origin,
    };
  });

test("browser retains a lost-response draft, reports real clipboard results, retries once and reopens after reload", async () => {
  const account = await promptBrowser();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    await context.addCookies(
      account.Cookie.split("; ").map((cookie) => {
        const split = cookie.indexOf("=");
        return {
          name: cookie.slice(0, split),
          value: cookie.slice(split + 1),
          url: origin,
        };
      })
    );
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(origin);
    await page
      .getByRole("heading", { name: "Your library is empty" })
      .waitFor();
    await page
      .getByRole("button", { name: "Create prompt", exact: true })
      .click();
    await page.getByLabel("Title (required)").fill("  Browser recovery  ");
    const content = "  My complete draft 🌍\n\tKeep whitespace\n ";
    await page.getByLabel("Content (required)").fill(content);
    let releaseResponse: (() => void) | undefined;
    // oxlint-disable-next-line promise/avoid-new -- Hold the real HTTP response until the UI has demonstrated Saving.
    const release = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const payloads: string[] = [];
    await page.route("**/api/v1/sync/mutations", async (route) => {
      payloads.push(route.request().postData() ?? "");
      if (payloads.length === 2) {
        const submitted = route.request().postDataJSON();
        await route.fulfill({
          json: {
            results: [
              {
                status: "rejected",
                error: {
                  code: "rate_limited",
                  message: "Wait before retrying.",
                  retryable: true,
                  retryAfter: 1,
                  operationId: submitted.operations[0].operationId,
                },
              },
            ],
          },
        });
        return;
      }
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (payloads.length === 1) {
        await release;
        await route.abort("failed");
      } else {
        await route.fulfill({ response });
      }
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saving…", { exact: true }).waitFor();
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      content
    );
    expect(
      await page.getByRole("button", { name: "Save", exact: true }).isDisabled()
    ).toBe(true);
    releaseResponse?.();
    await page.getByText(/^Not saved\./u).waitFor();
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      content
    );
    // The browser API is the clipboard system boundary; fail its write before testing a real permitted write.
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () => Promise.reject(new Error("Clipboard unavailable")),
      });
    });
    await page.getByRole("button", { name: "Copy text", exact: true }).click();
    await page.getByText(/^Could not copy text\./u).waitFor();
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      content
    );
    await page.evaluate(() => {
      Reflect.deleteProperty(navigator.clipboard, "writeText");
    });
    await page.getByRole("button", { name: "Copy text", exact: true }).click();
    await page.getByText("Copied text.", { exact: true }).waitFor();
    // Windows' system clipboard represents line endings as CRLF.
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.replaceAll("\r\n", "\n")).toBe(content);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page
      .getByText("Not saved. Wait before retrying.", { exact: true })
      .waitFor();
    expect(
      await page.getByLabel("Title (required)").getAttribute("readonly")
    ).not.toBeNull();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByText("Saved to server.", { exact: true }).waitFor();
    expect(payloads).toHaveLength(3);
    expect(payloads[0]).toBe(payloads[1]);
    expect(payloads[1]).toBe(payloads[2]);
    await page.getByLabel("Saved content").waitFor();
    expect(await page.getByLabel("Saved content").inputValue()).toBe(content);
    await page.reload();
    await page
      .getByRole("button", { name: "Browser recovery", exact: true })
      .click();
    await page.getByLabel("Saved content").waitFor();
    expect(await page.getByLabel("Saved content").inputValue()).toBe(content);
    const list = await account.get("");
    expect(await list.json()).toMatchObject({
      revision: "1",
      usage: { promptCount: 1 },
    });
    await page.screenshot({
      path: "docs/evidence/issue-29-saved-prompt.png",
      fullPage: true,
    });
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60_000);

test("an account change in another tab preserves this draft and never saves it into the new account", async () => {
  const [original, other] = await Promise.all([
    promptBrowser(),
    promptBrowser(),
  ]);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  try {
    await context.addCookies(cookies(original.Cookie));
    const page = await context.newPage();
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Create prompt", exact: true })
      .click();
    await page.getByLabel("Title (required)").fill("Original account draft");
    await page.getByLabel("Content (required)").fill("Keep my text");
    await context.clearCookies();
    await context.addCookies(cookies(other.Cookie));
    const refreshed = page.waitForResponse(`${origin}/api/v1/library`);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await refreshed;
    await page
      .getByText(/Your browser is now signed in to a different account/u)
      .waitFor();
    expect(await page.getByLabel("Title (required)").inputValue()).toBe(
      "Original account draft"
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText(/^Not saved\./u).waitFor();
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "Keep my text"
    );
    const otherLibrary = await other.get("");
    expect(await otherLibrary.json()).toMatchObject({
      usage: { promptCount: 0 },
    });
    await context.clearCookies();
    await context.addCookies(cookies(original.Cookie));
    const restored = page.waitForResponse(`${origin}/api/v1/library`);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await restored;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByText("Saved to server.", { exact: true }).waitFor();
    const originalLibrary = await original.get("");
    expect(await originalLibrary.json()).toMatchObject({
      usage: { promptCount: 1 },
    });
  } finally {
    await browser.close();
  }
}, 60_000);

test("browser reaches later pages and keeps an unsaved draft when a changed library restarts results", async () => {
  const account = await promptBrowser();
  await account.mutate(
    Array.from({ length: 51 }, (_, index) =>
      promptOperation({
        title: `Page prompt ${index}`,
        description: "",
        content: `Content ${index}`,
      })
    )
  );
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  try {
    await context.addCookies(
      account.Cookie.split("; ").map((cookie) => {
        const split = cookie.indexOf("=");
        return {
          name: cookie.slice(0, split),
          value: cookie.slice(split + 1),
          url: origin,
        };
      })
    );
    const page = await context.newPage();
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Page prompt 50", exact: true })
      .waitFor();
    expect(
      await page
        .getByRole("button", { name: "Page prompt 0", exact: true })
        .count()
    ).toBe(0);
    await page
      .getByRole("button", { name: "Create prompt", exact: true })
      .click();
    await page.getByLabel("Title (required)").fill("Keep this draft");
    await account.mutate([promptOperation()]);
    await page
      .getByRole("button", { name: "Load more prompts", exact: true })
      .click();
    await page
      .getByText(
        "Your library changed. Results restarted from the first page.",
        { exact: true }
      )
      .waitFor();
    await page
      .getByRole("button", { name: "Writing helper", exact: true })
      .waitFor();
    expect(await page.getByLabel("Title (required)").inputValue()).toBe(
      "Keep this draft"
    );
    await page
      .getByRole("button", { name: "Load more prompts", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Page prompt 0", exact: true })
      .click();
    await page.getByLabel("Saved content").waitFor();
    expect(await page.getByLabel("Saved content").inputValue()).toBe(
      "Content 0"
    );
    expect(await page.getByLabel("Title (required)").inputValue()).toBe(
      "Keep this draft"
    );
  } finally {
    await browser.close();
  }
}, 60_000);

test("browser warns before limits, preserves invalid input and an open draft during list changes", async () => {
  const account = await promptBrowser();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 640, height: 900 },
  });
  try {
    await context.addCookies(
      account.Cookie.split("; ").map((cookie) => {
        const split = cookie.indexOf("=");
        return {
          name: cookie.slice(0, split),
          value: cookie.slice(split + 1),
          url: origin,
        };
      })
    );
    const page = await context.newPage();
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Create prompt", exact: true })
      .click();
    await page.getByLabel("Title (required)").fill("🌍".repeat(201));
    await page.getByLabel("Content (required)").fill("\n  ");
    await page.getByText(/A prompt field is at or above 90%/u).waitFor();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText(/^Not saved\./u).waitFor();
    expect(await page.getByLabel("Title (required)").inputValue()).toBe(
      "🌍".repeat(201)
    );
    expect(
      await page.getByLabel("Content (required)").getAttribute("aria-invalid")
    ).toBe("true");
    await account.mutate([promptOperation()]);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    expect(await page.getByLabel("Title (required)").inputValue()).toBe(
      "🌍".repeat(201)
    );
    await page.screenshot({
      path: "docs/evidence/issue-29-draft-validation.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}, 60_000);
