import { changeStatusSchema } from "@pr0/api-contract/changes";
import {
  desktopCopySchema,
  desktopCopyResultSchema,
  desktopUsageStatusSchema,
} from "@pr0/api-contract/desktop-copy";
import type { DesktopCopy } from "@pr0/api-contract/desktop-copy";
import {
  desktopSearchSchema,
  desktopSearchPageSchema,
} from "@pr0/api-contract/desktop-search";
import type { DesktopSearch } from "@pr0/api-contract/desktop-search";
import {
  localPromptSchema,
  localSaveSchema,
  uploadStatusSchema,
  localLifecycleSchema,
  lifecycleResultSchema,
  localRecoverySchema,
} from "@pr0/api-contract/local-prompts";
import type {
  LocalSave,
  LocalLifecycle,
  LocalRecovery,
  LocalView,
} from "@pr0/api-contract/local-prompts";
import { promptSchema } from "@pr0/api-contract/prompts";
import {
  downloadStatusSchema,
  recoverySummariesSchema,
} from "@pr0/api-contract/snapshots";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import { upgradeRecoveryMessage } from "./upgrade-recovery";

const statusSchema = downloadStatusSchema.extend({
  recoveryError: z.string().nullable().optional(),
});
const summariesSchema = z
  .array(
    z.strictObject({ id: z.uuidv4(), title: z.string(), archived: z.boolean() })
  )
  .max(50);
export type DownloadStatus = z.infer<typeof statusSchema>;
export type DownloadedSummary = z.infer<typeof summariesSchema>[number];
export const libraryClient = {
  retained: async (id: string) =>
    promptSchema.parse(await invoke("library_retained_prompt", { id })),
  lifecycle: async (request: LocalLifecycle) => {
    const input = localLifecycleSchema.parse(request);
    const result = lifecycleResultSchema.safeParse(
      await invoke("library_lifecycle", { request: input })
    );
    const target =
      input.action.kind === "duplicate" ? input.action.copyId : input.promptId;
    if (!result.success || result.data.promptId !== target) {
      throw new Error("commit_uncertain");
    }
    return result.data;
  },
  recover: async (request: LocalRecovery) => {
    await invoke("library_recover", {
      request: localRecoverySchema.parse(request),
    });
  },
  list: async (offset: number, view: LocalView) =>
    summariesSchema.parse(
      await invoke(view === "recents" ? "library_recents" : "library_list", {
        offset,
        view,
      })
    ),
  search: async (request: DesktopSearch, signal: AbortSignal) => {
    const input = desktopSearchSchema.parse(request);
    signal.throwIfAborted();
    const cancel = async () => {
      try {
        await invoke("library_cancel_search", { id: input.requestId });
      } catch {
        /* The aborted response is still rejected below if native cancellation fails. */
      }
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const page = desktopSearchPageSchema.parse(
        await invoke("library_search", { request: input })
      );
      signal.throwIfAborted();
      if (
        page.instanceId !== input.instanceId ||
        page.accountId !== input.accountId
      ) {
        throw new Error("invalid_native_response");
      }
      return page;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  },
  recoverSearch: async (request: DesktopSearch) => {
    await invoke("library_recover_search", {
      request: desktopSearchSchema.parse(request),
    });
  },
  pauseDownload: async (paused: boolean) =>
    statusSchema.parse(await invoke("library_pause_download", { paused })),
  recoveryBrowse: async (offset: number) =>
    recoverySummariesSchema.parse(
      await invoke("library_recovery_browse", { offset })
    ),
  recoveryDetail: async (snapshotId: string, id: string) =>
    promptSchema.parse(
      await invoke("library_recovery_detail", { snapshotId, id })
    ),
  sync: async () => {
    await invoke("library_sync");
  },
  changeStatus: async () =>
    changeStatusSchema.parse(await invoke("library_change_status")),
  copy: async (request: DesktopCopy) => {
    const input = desktopCopySchema.parse(request);
    const result = desktopCopyResultSchema.safeParse(
      await invoke("library_copy", { request: input })
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
  recents: async (offset: number) =>
    summariesSchema.parse(await invoke("library_recents", { offset })),
  usageStatus: async () =>
    desktopUsageStatusSchema.parse(await invoke("library_usage_status")),
  retryUsage: async () =>
    desktopUsageStatusSchema.parse(await invoke("library_retry_usage")),
  upload: async () => uploadStatusSchema.parse(await invoke("library_upload")),
  uploadStatus: async () =>
    uploadStatusSchema.parse(await invoke("library_upload_status")),
  editor: async (id: string) =>
    localPromptSchema.parse(await invoke("library_editor", { id })),
  save: async (request: LocalSave) => {
    const input = localSaveSchema.parse(request);
    const response = localPromptSchema.safeParse(
      await invoke(
        input.expectedLocalRevision === null
          ? "library_create"
          : "library_edit",
        { request: input }
      )
    );
    if (!response.success) {
      throw new Error("commit_uncertain");
    }
    const result = response.data;
    if (
      result.prompt.id !== input.promptId ||
      result.prompt.accountId !== input.accountId ||
      result.prompt.instanceId !== input.instanceId
    ) {
      throw new Error("invalid_native_response");
    }
    return result;
  },
  copyDraft: async (request: LocalSave) => {
    // Copy recovery accepts even an invalid/oversized save draft within a bounded native limit.
    await invoke("library_copy_draft", {
      instanceId: request.instanceId,
      accountId: request.accountId,
      generation: request.generation,
      text: request.desired.content,
    });
  },
  status: async () => statusSchema.parse(await invoke("library_status")),
  download: async () => statusSchema.parse(await invoke("library_download")),
  browse: async (offset: number) =>
    summariesSchema.parse(await invoke("library_browse", { offset })),
  detail: async (id: string) =>
    promptSchema.parse(await invoke("library_detail", { id })),
};
export const downloadError = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native invoke rejection is an untrusted boundary; known codes map to fixed user-facing text.
  error: unknown,
  context: "download" | "search" = "download"
) => {
  const code = z.string().safeParse(error).data;
  const recovery = code ? upgradeRecoveryMessage(code) : undefined;
  if (recovery) {
    return recovery;
  }
  if (error === "operation_cancelled") {
    return context === "search"
      ? "The account changed. Refresh the connection before searching again."
      : "Download paused or already running. Saved prompts and pending work are retained.";
  }
  if (error === "disk_full") {
    return "There is not enough free disk space. Free some space and retry; saved prompts and pending changes are preserved.";
  }
  if (error === "search_recovery_required") {
    return "Search needs recovery. Rebuild the search index; saved prompts and pending changes are preserved.";
  }
  if (error === "search_busy" || error === "search_preparing") {
    return "Preparing search. Please retry shortly.";
  }
  if (error === "download_in_progress") {
    return "Download paused or already running. Saved prompts and pending work are retained.";
  }
  if (error === "insufficient_scratch_space") {
    return "Not enough free disk space to stage the library. Free disk space and retry; saved prompts and pending work are retained.";
  }
  if (error === "download_backoff") {
    return "Download paused after a connection or server error. Saved prompts remain available; retry shortly.";
  }
  if (error === "request_failed") {
    return "The server could not complete the download. Retry later; downloaded prompts are preserved.";
  }
  if (error === "redirect_rejected") {
    return "The server redirected the download. Check its canonical address; downloaded prompts are preserved.";
  }
  if (error === "authentication_required") {
    return "Sign in to resume downloading. Your downloaded prompts remain available.";
  }
  if (error === "network_unavailable") {
    return "Offline. Download paused; only downloaded prompts are available. Retry when connected.";
  }
  if (error === "snapshot_expired") {
    return "The download expired. Retry to start a fresh download; existing prompts are preserved.";
  }
  if (error === "snapshot_digest_mismatch" || error === "invalid_response") {
    return "The server returned invalid download data. Existing prompts are preserved. Retry or contact your server operator.";
  }
  return "The download could not be saved. Existing prompts are preserved. Check free disk space and retry.";
};
