import type { UploadStatus } from "@pr0/api-contract/local-prompts";
import { translate } from "@pr0/ui/lib/i18n";

const serviceFailureLabel = (upload?: UploadStatus) => {
  if (upload?.error === "compatibility_update_required") {
    return translate("updateRequiredChangesWaiting");
  }
  if (upload?.error === "account_suspended") {
    return translate("accountSuspendedChangesRetained");
  }
  if (upload?.error?.startsWith("retry_after:") && upload.retryAfterMs > 0) {
    return translate("serviceBusyRetryingInValueSecondsChangesRetained", [
      Math.ceil(upload.retryAfterMs / 1000),
    ]);
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
  if (!signedIn || upload?.error === "authentication_required") {
    return pending
      ? translate("signInToSyncChangesWaiting")
      : translate("signInToSync");
  }
  if (upload?.errors.length) {
    return translate("changesNeedAttentionChangesWaiting");
  }
  if (offline || upload?.error === "network_unavailable") {
    return pending
      ? translate("offlineChangesWaitingToSync")
      : translate("offline");
  }
  if (upload?.error) {
    return translate("couldnTSyncChangesWaiting");
  }
  if (upload?.awaitingDownload) {
    return pending
      ? translate("updatingThisDeviceSLibraryChangesWaiting")
      : translate("updatingThisDeviceSLibrary");
  }
  return pending
    ? translate("changesWaitingToSync")
    : translate("libraryStatus");
};
export const uploadFailureMessage = (code: string) => {
  if (code === "recovery_required") {
    return translate("theServerWasRestoredThisSavedVariantNeedsYourReview");
  }
  if (code === "quota_exceeded") {
    return translate(
      "serverCapacityReachedFreeCapacityAndRetryArchivingDoesNot"
    );
  }
  if (code === "dependency_blocked") {
    return translate("waitingForAnEarlierChangeToBeAcceptedYourText");
  }
  return translate("thisChangeNeedsAttentionYourTextIsRetainedOpenIt");
};
