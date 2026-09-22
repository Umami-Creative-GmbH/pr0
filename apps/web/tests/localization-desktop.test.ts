import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { localNativeWorker } from "./local-native-worker";
import { nativeWebview } from "./native-webview";

test("German desktop and launcher share a persistent English override without losing the open draft", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-language-91-"));
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const view = await nativeWebview(native.executable, directory, {}, "de-DE");
  try {
    const { page } = view;
    await page
      .getByRole("button", { name: "Neuer Prompt", exact: true })
      .click();
    expect(await page.evaluate(() => navigator.language)).toStartWith("de");
    const editor = page.getByRole("dialog", {
      name: "Neuer Prompt",
      exact: true,
    });
    await editor
      .getByLabel("Titel", { exact: true })
      .fill("Sprachwechsel {{name}}");
    await editor
      .getByLabel("Inhalt", { exact: true })
      .fill("Mein Text bleibt unverändert.");
    await editor
      .getByRole("button", {
        name: "Bibliothek durchsuchen (Entwurf behalten)",
      })
      .click();
    await page
      .getByRole("button", { name: "Schnellstarter öffnen", exact: true })
      .click();
    const [context] = view.browser.contexts();
    if (!context) {
      throw new Error("Missing native browser context");
    }
    const launcher =
      context
        .pages()
        .find((candidate) => candidate.url().includes("launcher.html")) ??
      (await context.waitForEvent("page"));
    await launcher
      .getByRole("searchbox", { name: "Prompts durchsuchen", exact: true })
      .waitFor();
    expect(await launcher.locator("html").getAttribute("lang")).toBe("de");
    await page.bringToFront();
    await page
      .getByRole("combobox", { name: "Sprache auf diesem Gerät" })
      .selectOption("en");
    await page
      .getByRole("button", { name: "Open quick launcher", exact: true })
      .click();
    await launcher
      .getByRole("searchbox", { name: "Search prompts", exact: true })
      .waitFor();
    expect(await launcher.locator("html").getAttribute("lang")).toBe("en");
    await page.bringToFront();
    await page
      .getByRole("button", { name: "Resume prompt draft", exact: true })
      .click();
    const englishEditor = page.getByRole("dialog", {
      name: "New prompt",
      exact: true,
    });
    expect(
      await englishEditor.getByLabel("Title", { exact: true }).inputValue()
    ).toBe("Sprachwechsel {{name}}");
    expect(
      await englishEditor.getByLabel("Content", { exact: true }).inputValue()
    ).toBe("Mein Text bleibt unverändert.");
    await englishEditor
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await englishEditor.waitFor({ state: "detached" });
    await page.reload();
    await page
      .getByRole("button", { name: "New prompt", exact: true })
      .waitFor();
    expect(await page.locator("html").getAttribute("lang")).toBe("en");
    await page
      .getByRole("combobox", { name: "Language on this device" })
      .selectOption("system");
    await page
      .getByRole("button", { name: "Schnellstarter öffnen", exact: true })
      .click();
    await launcher
      .getByRole("searchbox", { name: "Prompts durchsuchen", exact: true })
      .waitFor();
  } finally {
    await view.stop();
  }
});
