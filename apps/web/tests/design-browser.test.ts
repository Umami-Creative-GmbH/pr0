import { expect, test } from "bun:test";

import { copyBrowser, waitForCopy } from "./copy-browser-fixture";
import { captureDesign } from "./design-evidence";
import { promptBrowser, promptClient, promptOperation } from "./prompt-fixture";

test("designed web library persists edits and theme; quick access retains failed copies and fills variables in place", async () => {
  const account = await promptBrowser();
  const template = promptOperation({
    title: "Text professionell umschreiben",
    description: "Sachlicher Ton, gleiche Fakten, definierte Kürzung.",
    content:
      "Schreibe den folgenden Text professionell um. Kürze um {{kuerzung|number}} Prozent.\n\n{{text}}",
  });
  await account.mutate([
    template,
    ...Array.from({ length: 12 }, (_, index) =>
      promptOperation({
        title: `Writing helper ${index}`,
        description: "A reusable prompt for your daily work.",
        content: `Plain content ${index}`,
      })
    ),
  ]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const results = page.getByRole("region", { name: "Saved prompts" });
    await results
      .getByRole("button", { name: /^Text professionell umschreiben/u })
      .first()
      .click();
    await page
      .getByRole("heading", {
        name: "Text professionell umschreiben",
        exact: true,
      })
      .waitFor();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector(".wf-list")?.scrollTo(0, 0);
    });
    await page.screenshot({
      path: "docs/evidence/design-75/production-web-dark-detail.png",
    });
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await page.reload();
    expect(await page.locator(".wf").getAttribute("data-theme")).toBe("light");
    await results
      .getByRole("button", { name: /^Text professionell umschreiben/u })
      .first()
      .click();
    await page.screenshot({
      path: "docs/evidence/design-75/production-web-light-detail.png",
    });
    await page
      .getByRole("button", { name: "Create prompt", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Create prompt",
      exact: true,
    });
    await editor
      .getByLabel("Title (required)", { exact: true })
      .fill("Design persistence");
    await editor
      .getByLabel("Content (required)", { exact: true })
      .fill("Saved through production REST");
    await captureDesign(page, "web", "editor");
    await editor
      .getByRole("button", { name: "Browse library (keep draft)", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Resume prompt draft", exact: true })
      .click();
    expect(
      await editor
        .getByLabel("Content (required)", { exact: true })
        .inputValue()
    ).toBe("Saved through production REST");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await page.reload();
    await results
      .getByRole("button", { name: "Design persistence", exact: true })
      .click();
    expect(await page.getByLabel("Saved content").inputValue()).toBe(
      "Saved through production REST"
    );
    await page.keyboard.press("Control+k");
    const quick = page.getByRole("dialog", {
      name: "Quick access",
      exact: true,
    });
    const search = quick.getByRole("searchbox");
    await quick
      .getByRole("list", { name: "Quick access results" })
      .getByRole("button")
      .first()
      .waitFor();
    expect(
      await quick
        .getByRole("list", { name: "Quick access results" })
        .getByRole("button")
        .count()
    ).toBeGreaterThan(7);
    await captureDesign(page, "web-overlay", "results");
    await search.fill("Design persistence");
    await quick
      .getByRole("button", { name: "Design persistence Copy ↵", exact: true })
      .waitFor();
    await search.press("Control+Enter");
    await quick.waitFor({ state: "detached" });
    expect(await page.getByLabel("Saved content").inputValue()).toBe(
      "Saved through production REST"
    );
    const beforeCopy = await promptClient(account.Cookie).getPrompt(
      template.promptId
    );
    expect(beforeCopy.useCount).toBe(0);
    await page.keyboard.press("Control+k");
    await search.fill("no-such-prompt-75");
    await quick.getByText("No matching prompts", { exact: true }).waitFor();
    await captureDesign(page, "web-overlay", "empty");
    await search.fill("Design persistence");
    await quick
      .getByRole("button", { name: "Design persistence Copy ↵", exact: true })
      .waitFor();
    await page.evaluate(() => {
      window.clipboardTest.fail = true;
    });
    await search.press("Enter");
    await quick.getByText(/Could not copy/u).waitFor();
    expect(await search.inputValue()).toBe("Design persistence");
    await captureDesign(page, "web-overlay", "copy-error");
    await page.evaluate(() => {
      window.clipboardTest.fail = false;
    });
    await search.fill("Text professionell");
    await quick
      .getByRole("button", { name: /^Text professionell umschreiben Copy/u })
      .waitFor();
    await search.press("Enter");
    await quick.getByLabel("kuerzung (number)", { exact: true }).fill("20");
    await quick
      .getByLabel("text (string)", { exact: true })
      .fill("My source text");
    expect(await page.getByRole("dialog").count()).toBe(1);
    await captureDesign(page, "web-overlay", "variables");
    await quick
      .getByRole("button", { name: "Back to results", exact: true })
      .click();
    expect(await search.inputValue()).toBe("Text professionell");
    await search.press("Enter");
    await quick.getByLabel("kuerzung (number)", { exact: true }).fill("20");
    await quick
      .getByLabel("text (string)", { exact: true })
      .fill("My source text");
    await quick.getByRole("button", { name: "Copy", exact: true }).click();
    await quick.waitFor({ state: "detached" });
    await waitForCopy(page);
    await page.keyboard.press("/");
    const librarySearch = page.getByRole("searchbox", {
      name: "Search prompts",
      exact: true,
    });
    expect(
      await librarySearch.evaluate(
        (element) => element === document.activeElement
      )
    ).toBe(true);
    await librarySearch.fill("Design persistence");
    const keyboardRow = results.getByRole("button", {
      name: "Design persistence",
      exact: true,
    });
    await keyboardRow.waitFor();
    await librarySearch.press("ArrowDown");
    expect(
      await keyboardRow.evaluate((el) => el === document.activeElement)
    ).toBe(true);
    await librarySearch.focus();
    await librarySearch.press("Control+Enter");
    await waitForCopy(page);
    await librarySearch.fill("no-such-prompt-75");
    await results.getByText("No matching prompts", { exact: true }).waitFor();
    await captureDesign(page, "web", "empty");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const savedTemplate = await promptClient(account.Cookie).getPrompt(
      template.promptId
    );
    expect(savedTemplate.useCount).toBe(1);
    expect(savedTemplate.content).toContain("{{text}}");
  } finally {
    await ui.browser.close();
  }
}, 120_000);
