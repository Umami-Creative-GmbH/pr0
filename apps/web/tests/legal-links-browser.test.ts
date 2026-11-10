// oxlint-disable eslint/no-await-in-loop -- Keyboard focus order is a sequential user journey.
import { expect, test } from "bun:test";

import type { Page } from "playwright";

import { copyBrowser } from "./copy-browser-fixture";
import { promptBrowser } from "./prompt-fixture";

// The accessibility runner serves the same build without, then with, operator
// links; terms stay unconfigured in both cases.
const impressum = process.env.PR0_IMPRESSUM_URL;
const privacy = process.env.PR0_PRIVACY_URL;
const expected: [name: string, href: string][] =
  impressum && privacy
    ? [
        ["Legal notice", impressum],
        ["Privacy policy", privacy],
      ]
    : [];
const configured = expected.length > 0;

const legalNavigation = (page: Page) =>
  page.getByRole("navigation", { name: "Legal information", exact: true });

const expectLegalLinks = async (page: Page) => {
  const navigation = legalNavigation(page);
  if (!configured) {
    expect(await navigation.count()).toBe(0);
    for (const name of ["Legal notice", "Privacy policy", "Terms of use"]) {
      expect(await page.getByRole("link", { name }).count()).toBe(0);
    }
    return;
  }
  const links = navigation.getByRole("link");
  expect(await links.count()).toBe(expected.length);
  for (const [index, [name, href]] of expected.entries()) {
    const link = links.nth(index);
    expect(await link.textContent()).toBe(name);
    expect(await link.getAttribute("href")).toBe(href);
    expect(await link.getAttribute("target")).toBe("_blank");
    expect(await link.getAttribute("rel")).toBe("noopener noreferrer");
  }
  expect(
    await page.getByRole("link", { name: "Terms of use", exact: true }).count()
  ).toBe(0);
  // Keyboard users reach every link in document order.
  await page.locator("body").focus();
  const reached: string[] = [];
  for (let step = 0; step < 60 && reached.length < expected.length; step += 1) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() =>
      document.activeElement?.closest('nav[aria-label="Legal information"]')
        ? document.activeElement.textContent
        : null
    );
    if (name) {
      reached.push(name);
    }
  }
  expect(reached).toEqual(expected.map(([name]) => name));
};

test("legal links appear on sign-in, sign-up and the signed-in footer only when configured", async () => {
  const account = await promptBrowser();
  const ui = await copyBrowser("");
  try {
    const page = await ui.open();
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    await expectLegalLinks(page);
    await page
      .getByRole("button", { name: "Create a new account", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Create an account", exact: true })
      .waitFor();
    await expectLegalLinks(page);
    await ui.setAccount(account.Cookie);
    await page.reload();
    await page.getByRole("heading", { name: "Your library" }).waitFor();
    await expectLegalLinks(page);
    process.stdout.write(
      `Legal links journey (${configured ? "configured" : "unconfigured"}): ${ui.browser.version()}\n`
    );
  } finally {
    await ui.browser.close();
  }
}, 120_000);
