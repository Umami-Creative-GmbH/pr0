import type { Page } from "playwright";

import type { localNativeWorker, NativeArgs } from "./local-native-worker";

declare global {
  interface Window {
    nativeCommand: (
      command: string,
      args: NativeArgs
    ) => Promise<{ ok?: NativeArgs[string]; error?: string }>;
  }
}

export const connect = async (
  page: Page,
  native: Awaited<ReturnType<typeof localNativeWorker>>,
  fault: () => string,
  after: (command: string) => Promise<void> = async () => {
    /* No post-command hook requested. */
  }
) => {
  await page.exposeFunction(
    "nativeCommand",
    async (command: string, args: NativeArgs) => {
      try {
        const ok = await native.command(command, { ...args, fault: fault() });
        await after(command);
        if (
          fault() === "malformed_response" &&
          (command === "library_create" || command === "library_edit")
        ) {
          return { ok: null };
        }
        return { ok };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "native_unavailable",
        };
      }
    }
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
      value: {
        unregisterListener: () => {
          /* Native listeners are simulated by explicit refreshes. */
        },
      },
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (command: string, args: NativeArgs = {}) => {
          // Native events are notifications only; this test refreshes authoritative views explicitly.
          if (command.startsWith("plugin:event|")) {
            return 1;
          }
          const result = await window.nativeCommand(command, args);
          if (result.error) {
            throw result.error;
          }
          return result.ok;
        },
        transformCallback: () => 1,
      },
    });
  });
  await page.goto("http://localhost:1420");
};
