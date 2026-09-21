import type { BrowserContext, Locator, Page, Request } from "playwright";

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

const openDisclosure = async (summary: Locator) => {
  const open = await summary.evaluate(
    (element) => element.parentElement?.hasAttribute("open") ?? false
  );
  if (!open) {
    await summary.click();
  }
};

/**
 * Opens a "More …" actions menu by its accessible label, such as
 * "More prompt actions" or "More actions for <title>", unless already open.
 */
export const openActionsMenu = async (scope: Page | Locator, label: string) => {
  await openDisclosure(scope.getByLabel(label, { exact: true }));
};

/** Keyboard-only variant of `openActionsMenu`: focus the trigger, press Enter. */
export const openActionsMenuByKeyboard = async (
  page: Page,
  scope: Page | Locator,
  label: string
) => {
  const summary = scope.getByLabel(label, { exact: true });
  const open = await summary.evaluate(
    (element) => element.parentElement?.hasAttribute("open") ?? false
  );
  if (!open) {
    await summary.focus();
    await page.keyboard.press("Enter");
  }
};

const livePollPath = "/api/v1/sync/changes";
const quietMs = 500;

const networkTracker = () => {
  const inFlight = new Set<Request>();
  let quietSince = Date.now();
  return {
    started: (request: Request) => {
      if (!request.url().includes(livePollPath)) {
        inFlight.add(request);
      }
    },
    finished: (request: Request) => {
      if (inFlight.delete(request)) {
        quietSince = Date.now();
      }
    },
    /** `heldPath` names a request the journey deliberately keeps open. */
    idle: async (heldPath?: string) => {
      const deadline = Date.now() + 30_000;
      const busy = () =>
        [...inFlight].some(
          (request) => !heldPath || !request.url().includes(heldPath)
        );
      while (busy() || Date.now() - quietSince < quietMs) {
        if (Date.now() > deadline) {
          throw new Error("Network did not settle apart from the live poll");
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- Polling for quiet.
        await Bun.sleep(50);
      }
    },
  };
};

/**
 * Playwright's `networkidle` cannot settle while the live-change long poll is
 * open. Track every other request from page creation and wait until none has
 * been in flight for half a second.
 */
export const trackNetwork = (page: Page) => {
  const tracker = networkTracker();
  page.on("request", tracker.started);
  page.on("requestfinished", tracker.finished);
  page.on("requestfailed", tracker.finished);
  return { idle: tracker.idle };
};

/** `trackNetwork` for every page of a context, attached before pages open. */
export const trackContextNetwork = (context: BrowserContext) => {
  const tracker = networkTracker();
  context.on("request", tracker.started);
  context.on("requestfinished", tracker.finished);
  context.on("requestfailed", tracker.finished);
  return { idle: tracker.idle };
};

/** Reveals the collection filter chips, which rest inside a disclosure. */
export const openCollectionFilter = async (page: Page) => {
  await openDisclosure(
    page.locator("summary", { hasText: "Filter within this view" })
  );
};
