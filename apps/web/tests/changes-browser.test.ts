import { expect, test } from "bun:test";

import { chromium } from "playwright";

import { origin, cookieFrom } from "./http-fixture";
import { promptBrowser, promptOperation } from "./prompt-fixture";
import { githubLogin } from "./social-fixture";

const cookies = (value: string) =>
  value.split("; ").map((cookie) => {
    const separator = cookie.indexOf("=");
    return {
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      url: origin,
    };
  });

test("two web clients receive live changes without replacing an open draft or moving focus", async () => {
  const account = await promptBrowser();
  const operation = promptOperation({
    title: "Shared prompt",
    description: "",
    content: "Starting content",
  });
  const created = await account.mutate([operation]);
  expect(await created.json()).toMatchObject({
    results: [{ status: "accepted" }],
  });
  const browser = await chromium.launch({
    channel: process.env.PR0_TEST_BROWSER ?? "msedge",
    headless: true,
  });
  const secondCookie = cookieFrom(
    await githubLogin(account.subject, account.email)
  );
  const heldRead = Promise.withResolvers<undefined>();
  try {
    const contexts = await Promise.all([
      browser.newContext({ locale: "en-US" }),
      browser.newContext({ locale: "en-US" }),
    ]);
    await Promise.all(
      contexts.map((context, index) =>
        context.addCookies(cookies(index === 0 ? account.Cookie : secondCookie))
      )
    );
    const [first, second] = await Promise.all(
      contexts.map((context) => context.newPage())
    );
    if (!first || !second) {
      throw new Error("Missing browser page");
    }
    for (const page of [first, second]) {
      page.on("response", (response) => {
        if (response.status() >= 400) {
          process.stderr.write(
            `${new URL(response.url()).pathname}: ${response.status()}\n`
          );
        }
      });
      page.on("pageerror", (error) =>
        process.stderr.write(`${error.message}\n`)
      );
    }
    await first.goto(origin);
    await first
      .getByText("Up to date at last check", { exact: true })
      .waitFor();
    const captured = Promise.withResolvers<undefined>();
    let holding = false;
    await second.route(
      `**/api/v1/library/prompts/${operation.promptId}`,
      async (route) => {
        if (holding) {
          await route.continue();
          return;
        }
        holding = true;
        const response = await route.fetch();
        captured.resolve();
        await heldRead.promise;
        try {
          await route.fulfill({ response });
        } catch {
          /* The obsolete request was cancelled by catch-up. */
        }
      }
    );
    await second.goto(origin);
    await captured.promise;
    await first
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await first
      .getByLabel("Content (required)")
      .fill("Changed during initial read");
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await second
      .getByText("Changed during initial read", { exact: true })
      .waitFor({ timeout: 5000 });
    heldRead.resolve();
    await second
      .getByText("Up to date at last check", { exact: true })
      .waitFor();
    await second
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await second.getByLabel("Content (required)").fill("My unsaved draft");
    await first
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await first.getByLabel("Content (required)").fill("Saved on first client");
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await second
      .getByText("Saved on first client", { exact: true })
      .waitFor({ timeout: 5000 });
    expect(await second.getByLabel("Content (required)").inputValue()).toBe(
      "My unsaved draft"
    );
    expect(
      await second
        .getByLabel("Content (required)")
        .evaluate((element) => element === document.activeElement)
    ).toBe(true);
    await second
      .getByText("Up to date at last check", { exact: true })
      .waitFor({ timeout: 5000 });
    const row = second.getByRole("button", {
      name: "Shared prompt",
      exact: true,
    });
    await row.focus();
    await first
      .getByRole("button", { name: "Edit prompt", exact: true })
      .click();
    await first.getByLabel("Content (required)").fill("Another remote update");
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await second
      .getByText("Another remote update", { exact: true })
      .waitFor({ timeout: 5000 });
    heldRead.resolve();
    await second
      .getByText("Up to date at last check", { exact: true })
      .waitFor({ timeout: 5000 });
    expect(
      await row.evaluate((element) => element === document.activeElement)
    ).toBe(true);
    expect(await second.getByLabel("Content (required)").inputValue()).toBe(
      "My unsaved draft"
    );
  } finally {
    heldRead.resolve();
    await browser.close();
  }
});
