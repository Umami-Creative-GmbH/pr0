import type { Page } from "playwright";

export const measureSearch = async (page: Page, query: string) => {
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      'input[type="search"]:not(details input)'
    );
    if (!input) {
      throw new Error("Missing production search field");
    }
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator('[data-search-query=""]').waitFor();
  return await page.evaluate(async (value) => {
    const input = document.querySelector<HTMLInputElement>(
      'input[type="search"]:not(details input)'
    );
    if (!input) {
      throw new Error("Missing production search field");
    }
    const completed = Promise.withResolvers<undefined>();
    const observer = new MutationObserver(() => {
      if (
        document.querySelector<HTMLElement>("[data-search-query]")?.dataset
          .searchQuery === value
      ) {
        observer.disconnect();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => completed.resolve())
        );
      }
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      completed.reject(new Error("Search render timeout"));
    }, 30_000);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
    });
    if (!document.hasFocus()) {
      throw new Error(
        "Native library must be foreground while measuring search"
      );
    }
    const start = performance.now();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    try {
      await completed.promise;
      if (!document.hasFocus()) {
        throw new Error(
          "Native library lost foreground during search measurement"
        );
      }
      return performance.now() - start;
    } finally {
      clearTimeout(timeout);
      observer.disconnect();
    }
  }, query);
};
