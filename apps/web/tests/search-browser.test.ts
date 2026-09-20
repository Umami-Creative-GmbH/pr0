import { expect, test } from "bun:test";

import { chromium } from "playwright";

import { origin } from "./http-fixture";
import {
  promptBrowser,
  promptOperation,
  promptClient,
  promptEdit,
} from "./prompt-fixture";

test("typeahead keeps literal input, supports sort and clear, and never selects a nonmatch", async () => {
  const account = await promptBrowser();
  await account.mutate([
    promptOperation({ title: "Café", description: "", content: "C++ Straße" }),
    promptOperation({ title: "Other", description: "", content: "unrelated" }),
  ]);
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
    const search = page.getByRole("searchbox", { name: "Search prompts" });
    await search.fill(" CAFE ");
    const results = page.getByRole("region", { name: "Saved prompts" });
    await results.getByRole("button", { name: "Café", exact: true }).waitFor();
    expect(
      await results.getByRole("button", { name: "Other", exact: true }).count()
    ).toBe(0);
    await page.getByLabel("Sort prompts").selectOption("oldest");
    await search.fill("C++");
    await results.getByRole("button", { name: "Café", exact: true }).waitFor();
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe("oldest");
    await search.fill("no matches here");
    await page.getByText("No matching prompts", { exact: true }).waitFor();
    expect(await search.inputValue()).toBe("no matches here");
    expect(await page.getByLabel("Saved content").count()).toBe(0);
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    await results.getByRole("button", { name: "Other", exact: true }).waitFor();
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe(
      "recently-modified"
    );
    await search.fill("🌍".repeat(201));
    await page
      .getByText("Search must be at most 200 Unicode code points.", {
        exact: true,
      })
      .waitFor();
  } finally {
    await browser.close();
  }
});

test("selection follows identity across pages and a changed-revision page restarts visibly", async () => {
  const account = await promptBrowser();
  const operations = Array.from({ length: 70 }, (_, index) =>
    promptOperation({
      title: `Page ${String(index).padStart(3, "0")}`,
      description: "",
      content: `shared body ${index}`,
    })
  );
  await account.mutate(operations);
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
    await page.getByLabel("Sort prompts").selectOption("title");
    await page.getByRole("button", { name: "Page 000", exact: true }).click();
    await page.getByLabel("Saved content").waitFor();
    await page
      .getByRole("searchbox", { name: "Search prompts" })
      .fill("shared");
    await page.getByRole("button", { name: "Page 069", exact: true }).waitFor();
    expect(await page.getByLabel("Saved content").inputValue()).toBe(
      "shared body 0"
    );
    const more = page.getByRole("button", { name: "Load more prompts" });
    await more.click();
    await page.getByRole("button", { name: "Page 000", exact: true }).waitFor();
    expect(
      await page
        .getByRole("button", { name: "Page 000", exact: true })
        .getAttribute("aria-pressed")
    ).toBe("true");
    await page.getByLabel("Sort prompts").selectOption("oldest");
    await page.getByRole("button", { name: "Page 010", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search prompts" });
    await search.fill("x".repeat(201));
    await page
      .getByText("Search must be at most 200 Unicode code points.", {
        exact: true,
      })
      .waitFor();
    await search.fill("shared");
    await page.getByLabel("Saved content").waitFor();
    expect(await page.getByLabel("Saved content").inputValue()).toBe(
      "shared body 10"
    );
    expect(await page.getByLabel("Sort prompts").inputValue()).toBe("oldest");
    await page.getByRole("button", { name: "Page 000", exact: true }).click();
    await page.getByLabel("Sort prompts").selectOption("title");
    await page.getByRole("button", { name: "Page 049", exact: true }).waitFor();
    await account.mutate([
      promptOperation({ title: "Another", description: "", content: "shared" }),
    ]);
    await more.click();
    await page
      .getByText(
        "Your library changed. Results restarted from the first page.",
        { exact: true }
      )
      .waitFor();
    await page.getByRole("button", { name: "Another", exact: true }).waitFor();
    expect(await page.getByLabel("Saved content").inputValue()).toBe(
      "shared body 0"
    );
    const [first] = operations;
    if (!first) {
      throw new Error("Missing selection fixture");
    }
    const client = promptClient(account.Cookie);
    const base = await client.getPrompt(first.promptId);
    await account.mutate([
      promptEdit(base, {
        title: base.title,
        description: "",
        content: "removed eligibility",
      }),
    ]);
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Saved content"]'
        )?.value === "shared",
      {},
      { timeout: 25_000 }
    );
  } finally {
    await browser.close();
  }
});
