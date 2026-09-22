// oxlint-disable eslint/no-await-in-loop -- Keyboard focus order is a sequential user journey.
import { expect, test } from "bun:test";

import { trackNetwork } from "./app-menus";
import { copyBrowser } from "./copy-browser-fixture";
import { accountEmailLink, origin, password, post } from "./http-fixture";
import { promptBrowser } from "./prompt-fixture";

test("keyboard editor contains focus, identifies errors and offers a focused safe discard choice", async () => {
  const account = await promptBrowser();
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    const create = page.getByRole("button", {
      name: "Create prompt",
      exact: true,
    });
    await create.focus();
    await page.keyboard.press("Enter");
    const editor = page.getByRole("dialog", {
      name: "Create prompt",
      exact: true,
    });
    await editor.waitFor();
    for (let step = 0; step < 25; step += 1) {
      const fromBrowserChrome = await page.evaluate(
        () => document.activeElement === document.body
      );
      await page.keyboard.press("Tab");
      expect(
        await editor.evaluate(
          (element, requireInside) =>
            (!requireInside && document.activeElement === document.body) ||
            element.contains(document.activeElement),
          fromBrowserChrome
        )
      ).toBe(true);
    }
    for (let step = 0; step < 25; step += 1) {
      const fromBrowserChrome = await page.evaluate(
        () => document.activeElement === document.body
      );
      await page.keyboard.press("Shift+Tab");
      expect(
        await editor.evaluate(
          (element, requireInside) =>
            (!requireInside && document.activeElement === document.body) ||
            element.contains(document.activeElement),
          fromBrowserChrome
        )
      ).toBe(true);
    }
    await editor.getByRole("button", { name: "Save", exact: true }).focus();
    await page.keyboard.press("Enter");
    const title = editor.getByLabel("Title (required)", { exact: true });
    await page.waitForFunction(() =>
      document.querySelector('[aria-invalid="true"]')
    );
    expect(await title.getAttribute("aria-invalid")).toBe("true");
    expect(
      await title.evaluate((element) =>
        (element.getAttribute("aria-describedby") ?? "")
          .split(" ")
          .some((id) =>
            document
              .querySelector(`#${id}`)
              ?.textContent?.includes("Enter a title.")
          )
      )
    ).toBe(true);
    await title.fill("Keyboard draft");
    await editor
      .getByLabel("Content (required)", { exact: true })
      .fill("Preserve my draft");
    await page.keyboard.press("Escape");
    const confirmation = editor.getByRole("region", {
      name: "Discard unsaved prompt",
    });
    await confirmation.waitFor();
    const keep = confirmation.getByRole("button", {
      name: "Keep editing",
      exact: true,
    });
    expect(
      await keep.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    expect(
      await keep.evaluate(
        (element) =>
          document.querySelector(
            `#${CSS.escape(element.getAttribute("aria-describedby") ?? "")}`
          )?.textContent
      )
    ).toContain("Your draft will be lost.");
    await page.keyboard.press("Enter");
    expect(
      await title.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    expect(
      await editor
        .getByLabel("Content (required)", { exact: true })
        .inputValue()
    ).toBe("Preserve my draft");
    await page.keyboard.press("Escape");
    await confirmation
      .getByRole("button", { name: "Discard draft", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await editor.waitFor({ state: "detached" });
    expect(
      await create.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    process.stdout.write(
      `Accessibility keyboard journey: ${ui.browser.version()}\n`
    );
  } finally {
    await ui.browser.close();
  }
}, 120_000);

test("keyboard recovery returns to verified sign-in and account settings at a narrow viewport", async () => {
  const account = await promptBrowser();
  const ui = await copyBrowser(account.Cookie);
  try {
    await ui.context.clearCookies();
    const page = await ui.open();
    const network = trackNetwork(page);
    await page.setViewportSize({ width: 320, height: 800 });
    const recovery = page.getByRole("region", {
      name: "Recover your account",
      exact: true,
    });
    await recovery
      .getByLabel("Account email", { exact: true })
      .fill(account.email);
    await recovery
      .getByRole("button", { name: "Send recovery email", exact: true })
      .press("Enter");
    const queued = recovery.getByText(
      /^If this address belongs to a verified account/u
    );
    await queued.waitFor();
    expect(
      await queued.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.goto(await accountEmailLink(account.email));
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(`${password}-wrong`);
    await page
      .getByRole("button", { name: "Reset password", exact: true })
      .press("Enter");
    const mismatch = page.getByText("The passwords do not match.", {
      exact: true,
    });
    await mismatch.waitFor();
    expect(
      await mismatch.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(password);
    await page
      .getByRole("button", { name: "Reset password", exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: "Reset password", exact: true })
      .waitFor({ state: "detached" });
    await page
      .getByRole("link", { name: "Return to sign in", exact: true })
      .press("Enter");
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .press("Enter");
    // Recovery revoked prior sessions; create a second real session to revoke.
    const otherSession = await post("/api/auth/sign-in/email", {
      email: account.email,
      password,
    });
    expect(otherSession.ok).toBe(true);
    await network.idle();
    await page.getByLabel("Account menu", { exact: true }).press("Enter");
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .press("Enter");
    await page
      .getByRole("heading", { name: "Account settings", exact: true })
      .waitFor();
    await network.idle();
    const retrySessions = page.getByRole("button", {
      name: "Retry sessions",
      exact: true,
    });
    if (await retrySessions.isVisible()) {
      await retrySessions.press("Enter");
    }
    await page
      .getByRole("button", { name: "Revoke all other sessions", exact: true })
      .press("Enter");
    const revoked = page.getByText(
      "All other sessions revoked. This session is still signed in.",
      { exact: true }
    );
    await revoked.waitFor();
    expect(
      await revoked.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    expect(page.url()).toBe(`${origin}/`);
  } finally {
    await ui.browser.close();
  }
}, 120_000);
