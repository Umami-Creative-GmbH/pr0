import { changeStatusSchema } from "@pr0/api-contract/changes";
import {
  desktopCopySchema,
  desktopCopyResultSchema,
  desktopUsageStatusSchema,
} from "@pr0/api-contract/desktop-copy";
import type { DesktopCopy } from "@pr0/api-contract/desktop-copy";
import {
  localPromptSchema,
  localSaveSchema,
  uploadStatusSchema,
} from "@pr0/api-contract/local-prompts";
import type { LocalSave } from "@pr0/api-contract/local-prompts";
import { promptSchema } from "@pr0/api-contract/prompts";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

import { upgradeRecoveryMessage } from "./upgrade-recovery";

const statusSchema = z.strictObject({
  recoveryError: z.string().nullable().optional(),
  pendingChanges: z.number().int().nonnegative(),
  textBytes: z.number().int().nonnegative(),
  complete: z.boolean(),
  downloaded: z.number().int().min(0),
  total: z.number().int().min(0).max(10_000),
  appliedPages: z.number().int().min(0).max(1024),
  totalPages: z.number().int().min(0).max(1024),
  revision: z.string().nullable(),
  instanceId: z.uuid(),
  accountId: z.uuid(),
});
const summariesSchema = z
  .array(
    z.strictObject({ id: z.uuidv4(), title: z.string(), archived: z.boolean() })
  )
  .max(50);
export type DownloadStatus = z.infer<typeof statusSchema>;
export type DownloadedSummary = z.infer<typeof summariesSchema>[number];
export const libraryClient = {
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
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native invoke rejection is an untrusted boundary; known codes map to fixed user-facing text.
export const downloadError = (error: unknown) => {
  const code = z.string().safeParse(error).data;
  const recovery = code ? upgradeRecoveryMessage(code) : undefined;
  if (recovery) {
    return recovery;
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
  if (error === "local_update_required") {
    return "This library needs a newer version of pr0. Update the app; local data is preserved.";
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
