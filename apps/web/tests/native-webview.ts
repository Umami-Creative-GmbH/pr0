// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Wait for this isolated WebView's debugging endpoint to start.
import { chromium } from "playwright";

export const nativeWebview = async (
  executable: string,
  directory: string,
  env: Record<string, string> = {},
  locale = "en-US"
) => {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = reservation;
  await reservation.stop(true);
  const child = Bun.spawn(
    [
      executable,
      "--exact",
      "auth_tests::desktop_search_webview_worker",
      "--nocapture",
    ],
    {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        ...env,
        PR0_SEARCH_WEBVIEW_DIRECTORY: directory,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --lang=${locale} --accept-lang=${locale}`,
      },
    }
  );
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch(`${endpoint}/json/version`);
        ready = response.ok;
      } catch {
        // The runtime has not opened its local debugging socket yet.
      }
      if (ready) {
        break;
      }
      await Bun.sleep(100);
    }
    if (!ready) {
      throw new Error("WebView2 did not start");
    }
    // Keep WebView2 focus, fonts and media settings faithful to the native app.
    const browser = await chromium.connectOverCDP(endpoint, {
      noDefaults: true,
    });
    const [context] = browser.contexts();
    if (!context) {
      throw new Error("WebView2 has no application context");
    }
    // The debugging socket opens before both native-owned surfaces attach.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pages = context.pages();
      if (
        pages.some((entry) => entry.url().includes("launcher.html")) &&
        pages.some(
          (entry) =>
            entry.url() !== "about:blank" &&
            !entry.url().includes("launcher.html")
        )
      ) {
        break;
      }
      await Bun.sleep(100);
    }
    const page = context
      .pages()
      .find(
        (entry) =>
          entry.url() !== "about:blank" &&
          !entry.url().includes("launcher.html")
      );
    if (
      !page ||
      !context.pages().some((entry) => entry.url().includes("launcher.html"))
    ) {
      throw new Error("WebView2 did not attach both application surfaces");
    }
    return {
      browser,
      page,
      processId: child.pid,
      exited: child.exited,
      async stop() {
        await browser.close();
        child.kill();
        await child.exited;
      },
    };
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  }
};
