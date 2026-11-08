import assert from "node:assert/strict";

import { chromium } from "playwright";

import { selfHostingPassword } from "./self-hosting-fixture";
import type { SelfHostingInstance } from "./self-hosting-fixture";

export const selfHostingTemplate = "Hello {{name}}, count {{count|number}}";
export const selfHostingTitle = "Independent instance template";

export const verifySelfHostingBrowser = async (
  instance: SelfHostingInstance,
  email: string
) => {
  const browser = await chromium.launch({
    channel: process.env.PR0_TEST_BROWSER ?? "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    locale: "en-US",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const failures: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(
        `${new URL(response.url()).pathname}: ${response.status()}`
      );
    }
  });
  page.setDefaultTimeout(20_000);
  try {
    await page.goto(instance.origin);
    assert.equal(
      await page.getByRole("button", { name: /Google|GitHub/u }).count(),
      0
    );
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(selfHostingPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("heading", { name: "Your library is empty" })
      .waitFor();
    await page
      .getByRole("button", { name: "Create prompt", exact: true })
      .click();
    await page.getByLabel("Title (required)").fill(selfHostingTitle);
    await page.getByLabel("Content (required)").fill(selfHostingTemplate);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByLabel("Saved content").waitFor();
    assert.equal(
      await page.getByLabel("Saved content").inputValue(),
      selfHostingTemplate
    );
    await page.keyboard.press("Escape");
    await page
      .getByRole("searchbox", { name: "Search prompts" })
      .fill("independent instance");
    await page
      .getByRole("button", { name: /^Independent instance template/u })
      .waitFor();
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Fill prompt variables" });
    await dialog
      .getByLabel("name (string)", { exact: true })
      .fill("self-hoster");
    await dialog.getByLabel("count (number)", { exact: true }).fill("+02.50");
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await page.getByText("Copied. Usage recorded.", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "Hello self-hoster, count +02.50"
    );
    assert.equal(
      await page.getByLabel("Saved content").inputValue(),
      selfHostingTemplate
    );
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ failures })}\n`);
    throw error;
  } finally {
    await browser.close();
  }
};
