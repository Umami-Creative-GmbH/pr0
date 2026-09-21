// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Wait for this isolated WebView's debugging endpoint to start.
import { chromium } from "playwright";

export const nativeWebview = async (
  executable: string,
  directory: string,
  env: Record<string, string> = {}
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
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
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
    const browser = await chromium.connectOverCDP(endpoint);
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) {
      throw new Error("WebView2 has no application page");
    }
    return {
      browser,
      page,
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
