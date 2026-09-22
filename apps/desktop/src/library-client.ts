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
import { translate } from "@pr0/ui/lib/i18n";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import { upgradeRecoveryMessage } from "./upgrade-recovery";

const statusSchema = downloadStatusSchema;
const summariesSchema = z
  .array(
    z.strictObject({ id: z.uuidv4(), title: z.string(), archived: z.boolean() })
  )
  .max(50);
export type DownloadStatus = z.infer<typeof statusSchema>;
export type DownloadedSummary = z.infer<typeof summariesSchema>[number];
export const libraryClient = {
  copyTemplate: async (request: DesktopCopy, opening?: number) => {
    const input = desktopCopySchema.parse(request);
    const prompt = promptSchema.parse(
      await invoke("copy_template", { request: input, opening })
    );
    if (
      prompt.id !== input.promptId ||
      prompt.accountId !== input.accountId ||
      prompt.instanceId !== input.instanceId
    ) {
      throw new Error("invalid_native_response");
    }
    return prompt;
  },
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
      ? translate("theAccountChangedRefreshTheConnectionBeforeSearchingAgain")
      : translate("downloadPausedOrAlreadyRunningSavedPromptsAndPendingWork");
  }
  if (error === "disk_full") {
    return translate("thereIsNotEnoughFreeDiskSpaceFreeSomeSpace");
  }
  if (error === "search_recovery_required") {
    return translate("searchNeedsRecoveryRebuildTheSearchIndexSavedPromptsAnd");
  }
  if (error === "search_busy" || error === "search_preparing") {
    return translate("preparingSearchPleaseRetryShortly");
  }
  if (error === "download_in_progress") {
    return translate(
      "downloadPausedOrAlreadyRunningSavedPromptsAndPendingWork"
    );
  }
  if (error === "insufficient_scratch_space") {
    return translate("notEnoughFreeDiskSpaceToStageTheLibraryFree");
  }
  if (error === "download_backoff") {
    return translate("downloadPausedAfterAConnectionOrServerErrorSavedPrompts");
  }
  if (error === "request_failed") {
    return translate(
      "theServerCouldNotCompleteTheDownloadRetryLaterDownloaded"
    );
  }
  if (error === "redirect_rejected") {
    return translate(
      "theServerRedirectedTheDownloadCheckItsCanonicalAddressDownloaded"
    );
  }
  if (error === "authentication_required") {
    return translate(
      "signInToResumeDownloadingYourDownloadedPromptsRemainAvailable"
    );
  }
  if (error === "network_unavailable") {
    return translate(
      "offlineDownloadPausedOnlyDownloadedPromptsAreAvailableRetryWhen"
    );
  }
  if (error === "snapshot_expired") {
    return translate("theDownloadExpiredRetryToStartAFreshDownloadExisting");
  }
  if (error === "snapshot_digest_mismatch" || error === "invalid_response") {
    return translate(
      "theServerReturnedInvalidDownloadDataExistingPromptsArePreserved"
    );
  }
  return translate("theDownloadCouldNotBeSavedExistingPromptsArePreserved");
};
