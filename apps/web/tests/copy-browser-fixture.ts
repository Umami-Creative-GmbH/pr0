import { chromium } from "playwright";
import type { Page } from "playwright";

import { origin } from "./http-fixture";

declare global {
  interface Window {
    clipboardTest: {
      writes: string[];
      fail: boolean;
      delay: boolean;
      requireGesture?: boolean;
      gesture?: boolean;
      finish?: () => void;
    };
  }
}

export const copyBrowser = async (cookieHeader: string) => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const setAccount = (cookies: string) =>
    context.addCookies(
      cookies.split("; ").map((cookie) => {
        const split = cookie.indexOf("=");
        return {
          name: cookie.slice(0, split),
          value: cookie.slice(split + 1),
          url: origin,
        };
      })
    );
  await setAccount(cookieHeader);
  await context.addInitScript(() => {
    window.clipboardTest = { writes: [], fail: false, delay: false };
    document.addEventListener(
      "click",
      () => {
        window.clipboardTest.gesture = true;
        setTimeout(() => {
          window.clipboardTest.gesture = false;
        }, 0);
      },
      { capture: true }
    );
    const original = navigator.clipboard.write.bind(navigator.clipboard);
    Object.defineProperty(navigator.clipboard, "write", {
      configurable: true,
      value: async (items: ClipboardItem[]) => {
        if (
          window.clipboardTest.requireGesture &&
          !window.clipboardTest.gesture
        ) {
          throw new Error("Clipboard needs the original gesture");
        }
        const [item] = items;
        if (!item) {
          throw new Error("Missing clipboard item");
        }
        const blob = await item.getType("text/plain");
        const text = await blob.text();
        window.clipboardTest.writes.push(text);
        if (window.clipboardTest.fail) {
          throw new Error("Clipboard denied");
        }
        if (window.clipboardTest.delay) {
          const deferred = Promise.withResolvers<undefined>();
          window.clipboardTest.finish = () => deferred.resolve();
          await deferred.promise;
        }
        await original([new ClipboardItem({ "text/plain": blob })]);
      },
    });
  });
  const open = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    await page.goto(origin);
    return page;
  };
  return { browser, context, open, setAccount };
};

export const waitForCopy = (page: Page) =>
  page.getByText("Copied. Usage recorded.", { exact: true }).waitFor();
