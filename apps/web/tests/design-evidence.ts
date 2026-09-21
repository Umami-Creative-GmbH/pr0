import { mkdir } from "node:fs/promises";

import type { Page } from "playwright";

// These captures exercise the persisted theme setting; the journeys separately
// test switching themes through the visible button and reopening the application.
export const captureDesign = async (
  page: Page,
  surface: string,
  state: string
) => {
  await mkdir("docs/evidence/design-75", { recursive: true });
  for (const theme of ["dark", "light"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Each capture follows its own theme change.
    await page.evaluate((value) => {
      localStorage.setItem("pr0.theme", value);
      window.dispatchEvent(new Event("pr0-theme"));
    }, theme);
    // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Screenshots share one viewport and must be sequential.
    await page.screenshot({
      path: `docs/evidence/design-75/production-${surface}-${theme}-${state}.png`,
    });
  }
};
