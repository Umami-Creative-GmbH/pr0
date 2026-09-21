import { expect, test } from "bun:test";

import { chromium } from "playwright";

import {
  readDesktop,
  redeem,
  startDevice,
  tokenFrom,
  verifiedBrowser,
} from "./device-fixture";
import { password } from "./http-fixture";

test("system-browser page signs in with email, shows the matching code and requires explicit approval", async () => {
  const account = await verifiedBrowser();
  const code = await startDevice();
  const browser = await chromium.launch({
    channel: process.env.PR0_BROWSER_CHANNEL ?? "chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 800 },
    });
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto(code.verification_uri_complete);
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const approve = page.getByRole("button", { name: "Approve matching code" });
    await approve.waitFor();
    expect(await page.getByLabel("Matching desktop code").inputValue()).toBe(
      code.user_code
    );
    expect(await page.getByText(account.email, { exact: true }).count()).toBe(
      1
    );
    await approve.focus();
    await page.keyboard.press("Enter");
    await page
      .getByText("Desktop approved. Return to pr0 on your computer.")
      .waitFor();
    const credential = await tokenFrom(await redeem(code.device_code));
    const desktop = await readDesktop(credential.access_token);
    expect(desktop.account.id).toBe(account.library.account.id);
    expect(failures).toEqual([]);
  } finally {
    await browser.close();
  }
});
