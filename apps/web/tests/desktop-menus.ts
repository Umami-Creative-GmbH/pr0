import type { Locator, Page } from "playwright";

import { chooseAccountAction } from "./app-menus";

const isOpen = (summary: Locator) =>
  summary.evaluate(
    (element) => element.parentElement?.hasAttribute("open") ?? false
  );

const openDisclosure = async (summary: Locator) => {
  if (!(await isOpen(summary))) {
    await summary.click();
  }
};

/** Dismisses an open app bar popover with Escape so it stops covering the page. */
const closeDisclosure = async (page: Page, summary: Locator) => {
  if (await isOpen(summary)) {
    await page.keyboard.press("Escape");
  }
};

/** The sync status popover in the desktop app bar. */
export const syncStatus = (page: Page) =>
  page
    .locator("details.wf-menu")
    .filter({ has: page.locator("summary.wf-sync") });

/**
 * Opens the sync status popover unless it is already open. Pending changes,
 * download progress, retries and review entries rest inside it.
 */
export const openSyncStatus = async (page: Page) => {
  const status = syncStatus(page);
  await openDisclosure(status.locator("summary.wf-sync"));
  return status;
};

/** Closes the sync status popover, which otherwise overlays the library. */
export const closeSyncStatus = async (page: Page) => {
  await closeDisclosure(page, syncStatus(page).locator("summary.wf-sync"));
};

/** Opens the detail pane's "More prompt actions" menu unless already open. */
export const openPromptActions = async (scope: Page | Locator) => {
  await openDisclosure(
    scope.getByLabel("More prompt actions", { exact: true })
  );
};

/** Chooses a lifecycle action from the detail pane's "More prompt actions". */
export const choosePromptAction = async (
  detail: Page | Locator,
  name: string
) => {
  await openPromptActions(detail);
  await detail.getByRole("button", { name, exact: true }).click();
};

const closeAccountMenu = async (page: Page) => {
  await closeDisclosure(page, page.getByLabel("Account menu", { exact: true }));
};

/** Shows the account view, which hides the still-mounted library. */
export const openAccountView = async (page: Page) => {
  await chooseAccountAction(page, "Account and connection");
  await closeAccountMenu(page);
};

/** Returns from the account view to the library. */
export const backToLibrary = async (page: Page) => {
  await closeAccountMenu(page);
  await page
    .getByRole("main")
    .getByRole("button", { name: "Back to library", exact: true })
    .click();
};
