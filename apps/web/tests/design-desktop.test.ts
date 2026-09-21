import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { captureDesign } from "./design-evidence";
import { localNativeWorker } from "./local-native-worker";
import { holdNativeResource } from "./native-resource";
import { nativeWebview } from "./native-webview";

test("designed desktop keeps offline persistence, theme and a separate native launcher", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr0-design-75-"));
  const native = await localNativeWorker(directory, true);
  await native.stop();
  const control = path.join(directory, "save-control");
  await Bun.write(control, "ok");
  const view = await nativeWebview(native.executable, directory, {
    PR0_RESIDENT_SAVE_CONTROL: control,
  });
  try {
    const { page } = view;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "New prompt", exact: true }).click();
    const editor = page.getByRole("dialog", {
      name: "New prompt",
      exact: true,
    });
    await editor
      .getByLabel("Title", { exact: true })
      .fill("Text professionell umschreiben");
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Sachlicher Ton, gleiche Fakten, definierte Kürzung.");
    await editor
      .getByLabel("Content", { exact: true })
      .fill(
        "Schreibe den folgenden Text professionell und sachlich um.\n\nBehalte alle Fakten unverändert bei. Kürze um {{kuerzung|number}} Prozent. {{text}}"
      );
    await captureDesign(page, "desktop", "editor");
    await page.evaluate(() => {
      localStorage.setItem("pr0.theme", "dark");
      window.dispatchEvent(new Event("pr0-theme"));
    });
    await editor
      .getByRole("button", { name: "Browse library (keep draft)", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Resume prompt draft", exact: true })
      .click();
    expect(await editor.getByLabel("Title", { exact: true }).inputValue()).toBe(
      "Text professionell umschreiben"
    );
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await page
      .getByRole("heading", {
        name: "Text professionell umschreiben",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("list", { name: "Search results" })
      .getByRole("button", {
        name: "Text professionell umschreiben",
        exact: true,
      })
      .click();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector(".wf-list")?.scrollTo(0, 0);
    });
    await page.screenshot({
      path: "docs/evidence/design-75/production-desktop-dark-detail.png",
    });
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await page.screenshot({
      path: "docs/evidence/design-75/production-desktop-light-detail.png",
    });
    await page
      .getByRole("button", { name: "Open quick launcher", exact: true })
      .click();
    const [context] = view.browser.contexts();
    if (!context) {
      throw new Error("Missing native WebView context");
    }
    const launcher =
      context
        .pages()
        .find((candidate) => candidate.url().includes("launcher.html")) ??
      (await context.waitForEvent("page"));
    await launcher.setViewportSize({ width: 660, height: 580 });
    const search = launcher.getByRole("searchbox", {
      name: "Search prompts",
      exact: true,
    });
    await search.waitFor();
    await launcher
      .getByRole("list", { name: "Launcher results" })
      .getByRole("button")
      .first()
      .waitFor();
    expect(await launcher.getByRole("complementary").count()).toBe(0);
    await launcher.screenshot({
      path: "docs/evidence/design-75/production-native-launcher-light-results.png",
    });
    await search.fill("First");
    await launcher.getByRole("button", { name: /^First Copy/u }).waitFor();
    const releaseClipboard = await holdNativeResource(
      native.executable,
      "launcher_clipboard_worker",
      { PR0_HOLD_CLIPBOARD: "true" }
    );
    try {
      await launcher
        .getByRole("button", { name: "Copy selected prompt", exact: true })
        .click();
      await launcher
        .getByRole("alert")
        .filter({ hasText: "Could not copy" })
        .waitFor();
      expect(await search.inputValue()).toBe("First");
      await captureDesign(launcher, "native-launcher", "copy-error");
    } finally {
      await releaseClipboard();
    }
    await page
      .getByRole("button", { name: "Open quick launcher", exact: true })
      .press("Enter");
    await search.fill("Text professionell");
    await launcher
      .getByRole("button", { name: /^Text professionell umschreiben Copy/u })
      .click();
    await launcher.getByLabel("kuerzung (number)", { exact: true }).fill("20");
    await launcher
      .getByLabel("text (string)", { exact: true })
      .fill("Mein Text");
    await captureDesign(launcher, "native-launcher", "variables");
    await launcher.getByRole("button", { name: "Back", exact: true }).click();
    expect(await search.inputValue()).toBe("Text professionell");
    await search.fill("no-such-prompt-75");
    await launcher.getByText("No matching prompts", { exact: true }).waitFor();
    await launcher.screenshot({
      path: "docs/evidence/design-75/production-native-launcher-light-empty.png",
    });
    await launcher
      .getByRole("button", { name: "Switch to dark theme" })
      .click();
    await launcher.screenshot({
      path: "docs/evidence/design-75/production-native-launcher-dark-empty.png",
    });
    await search.fill("");
    await launcher
      .getByRole("list", { name: "Launcher results" })
      .getByRole("button")
      .first()
      .waitFor();
    await launcher.screenshot({
      path: "docs/evidence/design-75/production-native-launcher-dark-results.png",
    });
    await search.press("Escape");
    const mainSearch = page.getByRole("searchbox", {
      name: "Search downloaded prompts",
      exact: true,
    });
    await mainSearch.fill("no-such-prompt-75");
    await page.getByText("No matching prompts", { exact: true }).waitFor();
    await captureDesign(page, "desktop", "empty");
    await mainSearch.fill("");
    await page.getByRole("button", { name: "New prompt", exact: true }).click();
    await editor
      .getByLabel("Title", { exact: true })
      .fill("Retained on disk failure");
    await editor
      .getByLabel("Content", { exact: true })
      .fill("x".repeat(262_144));
    await Bun.write(control, "disk_full");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.getByText(/This device is out of storage/u).waitFor();
    await captureDesign(page, "desktop", "error");
  } finally {
    await view.stop();
  }
  const reopened = await nativeWebview(native.executable, directory);
  try {
    await reopened.page
      .getByRole("heading", {
        name: "Text professionell umschreiben",
        exact: true,
      })
      .waitFor();
    expect(
      await reopened.page
        .getByLabel("Prompt content", { exact: true })
        .inputValue()
    ).toContain("Behalte alle Fakten");
    expect(await reopened.page.locator(".wf").getAttribute("data-theme")).toBe(
      "light"
    );
  } finally {
    await reopened.stop();
  }
}, 60_000);
