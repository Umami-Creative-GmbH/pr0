import { expect, test } from "bun:test";

import { chromium } from "playwright";

import { cookieFrom, origin } from "./http-fixture";
import { seedCapacity } from "./prompt-capacity-fixture";
import {
  promptBrowser,
  promptOperation,
  promptClient,
  promptEdit,
} from "./prompt-fixture";
import { githubLogin } from "./social-fixture";

test("two browser sessions preserve a successor draft when a lost save response maps it to a conflict copy", async () => {
  const account = await promptBrowser();
  const secondCookie = cookieFrom(
    await githubLogin(account.subject, account.email)
  );
  const create = promptOperation({
    title: "Reply",
    description: "",
    content: "old",
  });
  const created = await account.mutate([create]);
  expect(await created.json()).toMatchObject({
    results: [{ status: "accepted" }],
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
    ]);
    const pages = await Promise.all(
      contexts.map(async (context, index) => {
        const Cookie = index === 0 ? account.Cookie : secondCookie;
        await context.addCookies(
          Cookie.split("; ").map((cookie) => {
            const split = cookie.indexOf("=");
            return {
              name: cookie.slice(0, split),
              value: cookie.slice(split + 1),
              url: origin,
            };
          })
        );
        const page = await context.newPage();
        page.on("pageerror", (error) =>
          process.stderr.write(`Browser error: ${error.message}\n`)
        );
        await page.goto(origin);
        try {
          await page
            .getByRole("button", { name: "Reply", exact: true })
            .click({ timeout: 15_000 });
        } catch (error) {
          process.stderr.write(
            (await page.locator("body").textContent()) ?? "No page text"
          );
          throw error;
        }
        await page
          .getByRole("button", { name: "Edit prompt", exact: true })
          .click({ timeout: 3000 });
        return page;
      })
    );
    const [a, b] = pages;
    if (!a || !b) {
      throw new Error("Two browser sessions required");
    }
    await a.getByLabel("Content (required)").fill("A");
    await a.getByRole("button", { name: "Save", exact: true }).click();
    await a.getByText("Saved to server.", { exact: true }).waitFor();
    await b.getByLabel("Content (required)").fill("B1");
    let release: (() => void) | undefined;
    // oxlint-disable-next-line promise/avoid-new -- Hold an actual committed HTTP reply while the author keeps typing.
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const payloads: string[] = [];
    await b.route("**/api/v1/sync/mutations", async (route) => {
      payloads.push(route.request().postData() ?? "");
      const response = await route.fetch();
      if (payloads.length === 1) {
        await held;
        await route.abort("failed");
      } else {
        await route.fulfill({ response });
      }
    });
    await b.getByRole("button", { name: "Save", exact: true }).click();
    await b.getByText("Saving…", { exact: true }).waitFor();
    await b.getByLabel("Content (required)").fill("B2");
    release?.();
    await b.getByText(/^Not saved\./u).waitFor();
    await b.getByRole("button", { name: "Retry", exact: true }).click();
    await b
      .getByText("You're editing the conflict copy.", { exact: true })
      .waitFor();
    expect(await b.getByLabel("Content (required)").inputValue()).toBe("B2");
    expect(await b.getByLabel("Title (required)").inputValue()).toBe(
      "Reply (conflict copy)"
    );
    expect(payloads[0]).toBe(payloads[1]);
    await b.getByText("Unsaved changes", { exact: true }).waitFor();
    await b.getByRole("button", { name: "Save", exact: true }).click();
    await b.getByText("Saved to server.", { exact: true }).waitFor();
    await b.waitForLoadState("networkidle");
    await b.reload();
    await b.getByText("Conflicts to review", { exact: true }).click();
    await b
      .getByRole("button", { name: "Open conflict copy", exact: true })
      .click();
    await b.getByLabel("Saved content").waitFor();
    expect(await b.getByLabel("Saved content").inputValue()).toBe("B2");
    await b.screenshot({
      path: "docs/evidence/issue-30-conflict-copy.png",
      fullPage: true,
    });
    await Promise.all(contexts.map((context) => context.close()));
    const client = promptClient(account.Cookie);
    const notices = await client.getConflicts();
    expect(notices.notices).toHaveLength(1);
    const [notice] = notices.notices;
    if (!notice) {
      throw new Error("Expected durable conflict notice");
    }
    expect(await client.getPrompt(notice.copyId)).toMatchObject({
      content: "B2",
    });
    expect(await client.getPrompt(create.promptId)).toMatchObject({
      content: "A",
    });
  } finally {
    await browser.close();
  }
}, 60_000);

test("incoming data never replaces an editor draft and quota refusal retains correction, retry and copy", async () => {
  const account = await promptBrowser();
  await seedCapacity(account.identity, "promptCount");
  const create = promptOperation({
    title: "Capacity draft",
    description: "",
    content: "old",
  });
  await account.mutate([create]);
  const client = promptClient(account.Cookie);
  const base = await client.getPrompt(create.promptId);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
      viewport: { width: 640, height: 900 },
    });
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
      .getByRole("button", { name: "Capacity draft", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await page.getByLabel("Content (required)").fill("Retain my full B draft");
    await page.waitForLoadState("networkidle");
    await client.mutatePrompts({
      ...account.identity,
      operations: [promptEdit(base, { ...create.desired, content: "A" })],
    });
    const incoming = page.waitForResponse(
      `${origin}/api/v1/library/prompts/${base.id}`
    );
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await incoming;
    await page.waitForLoadState("networkidle");
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "Retain my full B draft"
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText(/^Not saved\./u).waitFor();
    expect(await page.getByLabel("Content (required)").inputValue()).toBe(
      "Retain my full B draft"
    );
    await page.getByRole("button", { name: "Copy text", exact: true }).click();
    await page.getByText("Copied text.", { exact: true }).waitFor();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "Retain my full B draft"
    );
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByText(/^Not saved\./u).waitFor();
    await page.screenshot({
      path: "docs/evidence/issue-30-quota-draft.png",
      fullPage: true,
    });
    await page.getByLabel("Content (required)").fill("A");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved to server.", { exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    expect(await client.getConflicts()).toMatchObject({ notices: [] });
    expect(await client.getPrompts()).toMatchObject({
      usage: { promptCount: 10_000 },
    });
  } finally {
    await browser.close();
  }
}, 60_000);
