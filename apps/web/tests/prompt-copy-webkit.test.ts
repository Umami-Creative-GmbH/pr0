import { expect, test } from "bun:test";

import { promptUseFixtures } from "@pr0/api-contract/prompt-use-fixtures";
import { webkit } from "playwright";

import { origin } from "./http-fixture";
import { promptBrowser, promptClient, promptOperation } from "./prompt-fixture";

test("WebKit copies after asynchronous eligibility checks with the original user gesture", async () => {
  const account = await promptBrowser();
  const create = promptOperation({
    title: "WebKit clipboard",
    description: "",
    content: promptUseFixtures.text,
  });
  await account.mutate([create]);
  const browser = await webkit.launch({ headless: true });
  try {
    const context = await browser.newContext({
      locale: "en-US",
      permissions: ["clipboard-read"],
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
    page.setDefaultTimeout(15_000);
    await page.goto(origin);
    await page.getByLabel("Saved content").waitFor();
    await page
      .getByRole("button", { name: "Copy prompt", exact: true })
      .click();
    await page.getByText("Copied. Usage recorded.", { exact: true }).waitFor();
    const prompt = await promptClient(account.Cookie).getPrompt(
      create.promptId
    );
    expect(prompt.useCount).toBe(1);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.replaceAll("\r\n", "\n")).toBe(promptUseFixtures.text);
  } finally {
    await browser.close();
  }
});
