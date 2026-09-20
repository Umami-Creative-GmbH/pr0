import { promptSchema } from "@pr0/api-contract/prompts";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

const statusSchema = z.strictObject({
  complete: z.boolean(),
  downloaded: z.number().int().min(0).max(10_000),
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
  status: async () => statusSchema.parse(await invoke("library_status")),
  download: async () => statusSchema.parse(await invoke("library_download")),
  browse: async (offset: number) =>
    summariesSchema.parse(await invoke("library_browse", { offset })),
  detail: async (id: string) =>
    promptSchema.parse(await invoke("library_detail", { id })),
};
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native invoke rejection is an untrusted boundary; known codes map to fixed user-facing text.
export const downloadError = (error: unknown) => {
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
