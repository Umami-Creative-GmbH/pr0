import {
  desktopCopyResultSchema,
  desktopCopySchema,
} from "@pr0/api-contract/desktop-copy";
import type { DesktopCopy } from "@pr0/api-contract/desktop-copy";
import {
  launcherSearchSchema,
  launcherStatusSchema,
} from "@pr0/api-contract/desktop-launcher";
import { desktopSearchPageSchema } from "@pr0/api-contract/desktop-search";
import type { DesktopSearch } from "@pr0/api-contract/desktop-search";
import { invoke } from "@tauri-apps/api/core";

export const launcherClient = {
  status: async () =>
    launcherStatusSchema.parse(await invoke("launcher_status")),
  open: async () => {
    await invoke("launcher_open");
  },
  hide: async (opening: number) => {
    await invoke("launcher_hide", { opening });
  },
  focus: async () => {
    await invoke("launcher_focus");
  },
  retryShortcut: async () => {
    await invoke("launcher_retry_shortcut");
  },
  search: async (request: DesktopSearch, signal: AbortSignal) => {
    const input = launcherSearchSchema.parse(request);
    signal.throwIfAborted();
    const cancel = async () => {
      try {
        await invoke("launcher_cancel_search", { id: input.requestId });
      } catch {
        /* Abort still rejects the response when native cancellation is unavailable. */
      }
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const page = desktopSearchPageSchema.parse(
        await invoke("launcher_search", { request: input })
      );
      signal.throwIfAborted();
      if (
        page.instanceId !== input.instanceId ||
        page.accountId !== input.accountId ||
        page.prompts.some((prompt) => prompt.archived)
      ) {
        throw new Error("invalid_native_response");
      }
      return page;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  },
  copy: async (request: DesktopCopy, opening: number) => {
    const input = desktopCopySchema.parse(request);
    const result = desktopCopyResultSchema.safeParse(
      await invoke("launcher_copy", { request: input, opening })
    );
    if (
      !result.success ||
      result.data.origin.instanceId !== input.instanceId ||
      result.data.origin.accountId !== input.accountId ||
      result.data.origin.generation !== input.generation ||
      result.data.origin.promptId !== input.promptId
    ) {
      throw new Error("copy_uncertain");
    }
    return result.data;
  },
};
