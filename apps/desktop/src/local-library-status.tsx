import type { ChangeStatus } from "@pr0/api-contract/changes";
import type { UploadStatus } from "@pr0/api-contract/local-prompts";
import { LastChecked } from "@pr0/ui/components/last-checked";
import { AppBarStatus } from "@pr0/ui/components/wayfinder-shell";
import { useDismissable } from "@pr0/ui/hooks/use-dismissable";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
import { statusTone } from "@pr0/ui/lib/present";
import type { ReactNode } from "react";

import type { DownloadStatus } from "./library-client";
import { downloadError } from "./library-client";
import { RejectedChange } from "./rejected-change";
import { upgradeRecoveryMessage } from "./upgrade-recovery";
import { uploadLabel } from "./upload-status";
import { useSyncDetails } from "./use-sync-details";

const downloadLabel = (status?: DownloadStatus) => {
  if (status?.replacement) {
    return translate("updatingThisDeviceSLibraryYourExistingLibraryAndSaved");
  }
  if (status?.complete) {
    return translate("libraryDownloadedAtRevisionValueAvailableOffline", [
      status.revision,
    ]);
  }
  return translate(
    "downloadingLibraryValuePromptsAvailableTheOfflineLibraryIsIncomplete",
    [status?.downloaded ?? 0]
  );
};

export const DownloadProgress = ({
  status,
  signedIn,
}: {
  status?: DownloadStatus;
  signedIn: boolean;
}) => {
  const t = useTranslations();
  return (
    <>
      <p className="block">{downloadLabel(status)}</p>
      {status?.paused ? (
        <p>{t("downloadPausedResumeWhenYouAreReadyLocalWorkIs")}</p>
      ) : null}
      {status?.catchingUp ? (
        <p>
          {t(
            "snapshotPagesDownloadedApplyingInterveningChangesBeforeSwitchingLibrariesPending"
          )}
        </p>
      ) : null}
      {status && status.totalPages > 0 ? (
        <progress
          aria-label={t("libraryDownloadProgress")}
          max={status.totalPages}
          value={status.appliedPages}
        />
      ) : null}
      {status && status.totalPages > 0 ? (
        <p>
          {status.appliedPages} {t("of")} {status.totalPages}{" "}
          {t("snapshotPagesSaved")}
        </p>
      ) : null}
      {signedIn ? null : (
        <p>{t("signInToResumeDownloadingDownloadedPromptsRemainAvailable")}</p>
      )}
    </>
  );
};

export const DownloadControls = ({
  status,
  signedIn,
  busy,
  errorText,
  onPause,
  onRetry,
}: {
  status?: DownloadStatus;
  signedIn: boolean;
  busy: boolean;
  errorText: string;
  onPause: () => void;
  onRetry: () => void;
}) => {
  const t = useTranslations();
  return (
    <>
      <DownloadProgress status={status} signedIn={signedIn} />
      {errorText || status?.error ? (
        <p>{errorText || downloadError(status?.error)}</p>
      ) : null}
      {status?.complete ? null : (
        <button type="button" onClick={onPause}>
          {status?.paused ? t("resumeDownload") : t("pauseDownload")}
        </button>
      )}
      {!status?.complete && signedIn ? (
        <button
          type="button"
          disabled={busy}
          onClick={onRetry}
          className="wf-btn"
        >
          {t("retryDownload")}
        </button>
      ) : null}
    </>
  );
};

const admissionLabel = (
  changes: ChangeStatus | undefined,
  upload: UploadStatus | undefined,
  pending: number
) => {
  if (
    changes?.error === "account_suspended" ||
    upload?.error === "account_suspended"
  ) {
    return translate("accountSuspendedLocalWorkRetained");
  }
  if (changes?.error?.startsWith("retry_after:") && changes.retryAfterMs > 0) {
    return translate("serviceBusyRetryingInValueSecondsValue", [
      Math.ceil(changes.retryAfterMs / 1000),
      pending ? translate("changesWaiting") : "",
    ]);
  }
  return null;
};

const incomingFailureLabel = (
  status: DownloadStatus | undefined,
  changes: ChangeStatus | undefined,
  attentionError?: string | null
) => {
  const pending = Boolean(status?.pendingChanges);
  if (changes?.error === "authentication_required") {
    return pending
      ? translate("signInToSyncChangesWaiting")
      : translate("signInToSync");
  }
  if (changes?.error === "network_unavailable") {
    return pending
      ? translate("offlineChangesWaitingToSync")
      : translate("offline");
  }
  if (changes?.error === "snapshot_required") {
    return translate("libraryRecoveryRequired");
  }
  if (
    changes?.error ||
    status?.error ||
    status?.recoveryError ||
    attentionError
  ) {
    return pending
      ? translate("couldnTSyncChangesWaiting")
      : translate("couldnTCheckForUpdates");
  }
  return null;
};
const incomingLabel = (
  status: DownloadStatus | undefined,
  signedIn: boolean,
  upload: UploadStatus | undefined,
  changes: ChangeStatus | undefined,
  label: string
) => {
  if (
    label !== translate("libraryStatus") &&
    label !== translate("changesWaitingToSync")
  ) {
    return label;
  }
  const pending = Boolean(status?.pendingChanges);
  if (!signedIn) {
    return pending
      ? translate("signInToSyncChangesWaiting")
      : translate("signInToSync");
  }
  const errorLabel = incomingFailureLabel(
    status,
    changes,
    upload?.attentionError
  );
  if (errorLabel) {
    return errorLabel;
  }
  if (changes?.updating || !status?.complete || status.replacement) {
    return pending
      ? translate("updatingThisDeviceSLibraryChangesWaiting")
      : translate("updatingThisDeviceSLibrary");
  }
  return !pending && changes?.lastCheckedAt
    ? translate("upToDateAtLastCheck")
    : label;
};
const ConnectionDetails = ({
  signedIn,
  offline,
  upload,
  changes,
}: {
  signedIn: boolean;
  offline: boolean;
  upload?: UploadStatus;
  changes?: ChangeStatus;
}) => {
  const t = useTranslations();
  return (
    <>
      {offline ||
      changes?.error === "network_unavailable" ||
      upload?.error === "network_unavailable" ? (
        <p>{t("offlineDurablySavedWorkRemainsOnThisDeviceAndWill")}</p>
      ) : null}
      {!signedIn ||
      changes?.error === "authentication_required" ||
      upload?.error === "authentication_required" ? (
        <p>{t("signInToTheSameAccountOnTheSameInstance")}</p>
      ) : null}
    </>
  );
};
const RejectedChanges = ({
  upload,
  onOpen,
}: {
  upload?: UploadStatus;
  onOpen: (id: string) => void;
}) => {
  const t = useTranslations();
  return (
    <ul>
      {upload?.errors.map((entry) => {
        const deleting = upload.pending.some(
          (pending) => pending.promptId === entry.promptId && pending.deleting
        );
        return (
          <li key={`${entry.promptId}:${entry.code}`}>
            {deleting ? (
              <p>{t("deletionPending")}</p>
            ) : (
              <button type="button" onClick={() => onOpen(entry.promptId)}>
                {t("openRetainedPrompt")}
              </button>
            )}
            <RejectedChange entry={entry} deleting={deleting} />
          </li>
        );
      })}
    </ul>
  );
};
const incomingExplanation = (error: string) => {
  if (error === "account_suspended") {
    return translate(
      "contactYourInstanceOperatorSuspensionDoesNotDeleteYourLocal"
    );
  }
  if (error === "snapshot_required") {
    return translate("thisLibraryNeedsARecoveryDownload");
  }
  return translate(
    "synchronizationRetriesWhenTheConnectionAndAccountAreAvailable"
  );
};
const IncomingError = ({ changes }: { changes?: ChangeStatus }) => {
  const t = useTranslations();
  return changes?.error ? (
    <p>
      {t("incomingUpdatesArePausedSavedLocalWorkAndDraftsAre")}{" "}
      {incomingExplanation(changes.error)}
    </p>
  ) : null;
};
const RecoveryError = ({ code }: { code?: string | null }) => {
  const t = useTranslations();
  return code ? (
    <p>
      {t("searchPreparationCouldNotFinish")}{" "}
      {upgradeRecoveryMessage(code) ??
        t("checkStorageAccessAndRestartPr0ToRetryBrowsingAnd")}
    </p>
  ) : null;
};
const UploadError = ({ code }: { code?: string | null }) => {
  const t = useTranslations();
  return code ? (
    <p>
      {upgradeRecoveryMessage(code) ??
        (code === "incompatible_instance"
          ? t("updatePr0OrCheckYourInstanceAddressBeforeSyncingLocal")
          : t(
              "localWorkIsPreservedSynchronizationWillRetryAutomaticallyWhenThe"
            ))}
    </p>
  ) : null;
};
const acceptedDownloadLabel = (upload: UploadStatus) => {
  if (upload.errors.some((entry) => entry.code === "recovery_required")) {
    return translate(
      "valuePreviouslyAcceptedVariantsAreRetainedLocallyTheServerWas",
      [upload.awaitingDownload]
    );
  }
  return translate(
    "valueAcceptedOperationsAreSavedToServerDownloadingCurrentRecords",
    [upload.awaitingDownload]
  );
};
const TransferDetails = ({
  status,
  upload,
  changes,
}: {
  status?: DownloadStatus;
  upload?: UploadStatus;
  changes?: ChangeStatus;
}) => {
  const t = useTranslations();
  return (
    <>
      {changes?.updating ||
      !status?.complete ||
      status?.replacement ||
      upload?.awaitingDownload ? (
        <p>{t("updatingThisDeviceAposSLibrarySavedLocalWorkAnd")}</p>
      ) : null}
      <RecoveryError code={status?.recoveryError} />
      <IncomingError changes={changes} />
      {upload?.attentionError ? (
        <p>
          {t(
            "couldNotRefreshReviewNoticesPreviouslyDownloadedReviewsRemainAvailable"
          )}
        </p>
      ) : null}
      {upload?.awaitingDownload ? <p>{acceptedDownloadLabel(upload)}</p> : null}
      <UploadError code={upload?.error} />
      {upload?.retryAfterMs ? (
        <p>
          {t("retryAvailableIn")} {Math.ceil(upload.retryAfterMs / 1000)}{" "}
          {t("seconds")}
        </p>
      ) : null}
    </>
  );
};
export const LocalLibraryStatus = ({
  status,
  signedIn,
  offline,
  upload,
  changes,
  onOpen,
  onRetry,
  children,
  organizationAttention = false,
  saveFailure = false,
}: {
  status?: DownloadStatus;
  signedIn: boolean;
  offline: boolean;
  upload?: UploadStatus;
  changes?: ChangeStatus;
  onOpen: (id: string) => void;
  onRetry: () => void;
  children?: ReactNode;
  organizationAttention?: boolean;
  saveFailure?: boolean;
}) => {
  const t = useTranslations();

  const details = useSyncDetails();
  useDismissable(details);
  const pendingChanges = status?.pendingChanges ?? 0;
  const label = organizationAttention
    ? t("changesNeedAttentionChangesWaiting")
    : (admissionLabel(changes, upload, pendingChanges) ??
      incomingLabel(
        status,
        signedIn,
        upload,
        changes,
        uploadLabel(signedIn, offline, pendingChanges, upload)
      ));
  return (
    <AppBarStatus>
      <details className="wf-menu" ref={details}>
        <summary className="wf-sync">
          <span
            className="wf-dot"
            data-tone={statusTone(label, saveFailure || organizationAttention)}
          />
          <span>{saveFailure ? t("notSavedUnsavedDraft") : label}</span>
        </summary>
        <div className="wf-popover">
          {saveFailure ? (
            <p>
              {label}
              {t("theDraftCouldNotBeSavedKeepTheEditorOpen")}
            </p>
          ) : null}
          <p>
            {pendingChanges}{" "}
            {t("pendingChangesSavedLocalChangesAwaitSynchronization")}
          </p>
          <LastChecked at={changes?.lastCheckedAt} />
          <ConnectionDetails
            signedIn={signedIn}
            offline={offline}
            upload={upload}
            changes={changes}
          />
          <TransferDetails status={status} upload={upload} changes={changes} />
          <RejectedChanges upload={upload} onOpen={onOpen} />
          <button
            type="button"
            disabled={!signedIn || Boolean(upload?.retryAfterMs)}
            onClick={onRetry}
          >
            {t("retrySync")}
          </button>
          {status &&
          (status.downloaded >= 9000 || status.textBytes >= 94_371_840) ? (
            <p>{t("yourLibraryIsNearItsCapacityArchivingDoesNotFree")}</p>
          ) : null}
          {children}
        </div>
      </details>
    </AppBarStatus>
  );
};
