import type { UploadStatus } from "@pr0/api-contract/local-prompts";

const serviceFailureLabel = (upload?: UploadStatus) => {
  if (upload?.error === "compatibility_update_required") {
    return "Update required · Changes waiting";
  }
  if (upload?.error === "account_suspended") {
    return "Account suspended · Changes retained";
  }
  if (upload?.error?.startsWith("retry_after:") && upload.retryAfterMs > 0) {
    return `Service busy · Retrying in ${Math.ceil(upload.retryAfterMs / 1000)} seconds · Changes retained`;
  }
};
export const uploadLabel = (
  signedIn: boolean,
  offline: boolean,
  pending: number,
  upload?: UploadStatus
) => {
  const failure = serviceFailureLabel(upload);
  if (failure) {
    return failure;
  }
  if (!signedIn && pending) {
    return "Sign in to sync · Changes waiting";
  }
  if (upload?.errors.length) {
    return "Changes need attention · Changes waiting";
  }
  if (offline || upload?.error === "network_unavailable") {
    return pending ? "Offline · Changes waiting to sync" : "Offline";
  }
  if (upload?.error) {
    return "Couldn't sync · Changes waiting";
  }
  if (upload?.awaitingDownload) {
    return "Updating this device's library…";
  }
  return pending ? "Changes waiting to sync" : "Library status";
};
export const uploadFailureMessage = (code: string) => {
  if (code === "recovery_required") {
    return "The server was restored. This saved variant needs your review before recovery. Copy its text into a new prompt to preserve it separately; the original pending identity is retained.";
  }
  if (code === "quota_exceeded") {
    return "Server capacity reached. Free capacity and retry; archiving does not free capacity. Your text remains available to edit or copy.";
  }
  if (code === "dependency_blocked") {
    return "Waiting for an earlier change to be accepted. Your text is retained.";
  }
  return "This change needs attention. Your text is retained; open it to review or copy.";
};
