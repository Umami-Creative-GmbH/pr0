import type { Page } from "playwright";

/** Opens the account menu in the app bar unless it is already open. */
export const openAccountMenu = async (page: Page) => {
  const menu = page.getByLabel("Account menu", { exact: true });
  const open = await menu.evaluate(
    (summary) => summary.parentElement?.hasAttribute("open") ?? false
  );
  if (!open) {
    await menu.click();
  }
};

/** Chooses an entry of the account menu, such as Settings or Quit pr0. */
export const chooseAccountAction = async (page: Page, name: string) => {
  await openAccountMenu(page);
  await page.getByRole("button", { name, exact: true }).click();
};

/**
 * The editor is modal. Leave it mounted with its draft while the journey uses
 * the library, and return with `resumeDraft`.
 */
export const browseKeepingDraft = async (page: Page) => {
  await page
    .getByRole("button", { name: "Browse library (keep draft)", exact: true })
    .click();
};

export const resumeDraft = async (page: Page) => {
  await page
    .getByRole("button", { name: "Resume prompt draft", exact: true })
    .click();
};
