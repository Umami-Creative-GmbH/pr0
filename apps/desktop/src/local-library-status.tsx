import type { ChangeStatus } from "@pr0/api-contract/changes";
import type { UploadStatus } from "@pr0/api-contract/local-prompts";
import { LastChecked } from "@pr0/ui/components/last-checked";
import type { ReactNode } from "react";

import type { DownloadStatus } from "./library-client";
import { downloadError } from "./library-client";
import { RejectedChange } from "./rejected-change";
import { upgradeRecoveryMessage } from "./upgrade-recovery";
import { uploadLabel } from "./upload-status";
import { useSyncDetails } from "./use-sync-details";

const downloadLabel = (status?: DownloadStatus) => {
  if (status?.replacement) {
    return "Updating this device's library… Your existing library and saved local work remain available.";
  }
  if (status?.complete) {
    return `Library downloaded at revision ${status.revision}. Available offline.`;
  }
  return `Downloading library: ${status?.downloaded ?? 0} prompts available. The offline library is incomplete.`;
};

export const DownloadProgress = ({
  status,
  signedIn,
}: {
  status?: DownloadStatus;
  signedIn: boolean;
}) => (
  <>
    <p className="block">{downloadLabel(status)}</p>
    {status?.paused ? (
      <p>Download paused. Resume when you are ready; local work is retained.</p>
    ) : null}
    {status?.catchingUp ? (
      <p>
        Snapshot pages downloaded. Applying intervening changes before switching
        libraries. Pending uploads may still need attention.
      </p>
    ) : null}
    {status && status.totalPages > 0 ? (
      <progress
        aria-label="Library download progress"
        max={status.totalPages}
        value={status.appliedPages}
      />
    ) : null}
    {status && status.totalPages > 0 ? (
      <p>
        {status.appliedPages} of {status.totalPages} snapshot pages saved.
      </p>
    ) : null}
    {signedIn ? null : (
      <p>Sign in to resume downloading. Downloaded prompts remain available.</p>
    )}
  </>
);

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
}) => (
  <>
    <DownloadProgress status={status} signedIn={signedIn} />
    {errorText || status?.error ? (
      <p>{errorText || downloadError(status?.error)}</p>
    ) : null}
    {status?.complete ? null : (
      <button type="button" onClick={onPause}>
        {status?.paused ? "Resume download" : "Pause download"}
      </button>
    )}
    {!status?.complete && signedIn ? (
      <button
        type="button"
        disabled={busy}
        onClick={onRetry}
        className="rounded border px-4 py-2"
      >
        Retry download
      </button>
    ) : null}
  </>
);

const admissionLabel = (
  changes: ChangeStatus | undefined,
  upload: UploadStatus | undefined,
  pending: number
) => {
  if (
    changes?.error === "account_suspended" ||
    upload?.error === "account_suspended"
  ) {
    return "Account suspended · Local work retained";
  }
  if (changes?.error?.startsWith("retry_after:") && changes.retryAfterMs > 0) {
    return `Service busy · Retrying in ${Math.ceil(changes.retryAfterMs / 1000)} seconds${pending ? " · Changes waiting" : ""}`;
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
    return pending ? "Sign in to sync · Changes waiting" : "Sign in to sync";
  }
  if (changes?.error === "network_unavailable") {
    return pending ? "Offline · Changes waiting to sync" : "Offline";
  }
  if (changes?.error === "snapshot_required") {
    return "Library recovery required";
  }
  if (
    changes?.error ||
    status?.error ||
    status?.recoveryError ||
    attentionError
  ) {
    return pending
      ? "Couldn't sync · Changes waiting"
      : "Couldn't check for updates";
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
  if (label !== "Library status" && label !== "Changes waiting to sync") {
    return label;
  }
  const pending = Boolean(status?.pendingChanges);
  if (!signedIn) {
    return pending ? "Sign in to sync · Changes waiting" : "Sign in to sync";
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
      ? "Updating this device's library… · Changes waiting"
      : "Updating this device's library…";
  }
  return !pending && changes?.lastCheckedAt
    ? "Up to date at last check"
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
}) => (
  <>
    {offline ||
    changes?.error === "network_unavailable" ||
    upload?.error === "network_unavailable" ? (
      <p>
        Offline. Durably saved work remains on this device and will retry when
        connectivity returns.
      </p>
    ) : null}
    {!signedIn ||
    changes?.error === "authentication_required" ||
    upload?.error === "authentication_required" ? (
      <p>
        Sign in to the same account on the same instance to sync. Local access
        and pending work are preserved.
      </p>
    ) : null}
  </>
);
const RejectedChanges = ({
  upload,
  onOpen,
}: {
  upload?: UploadStatus;
  onOpen: (id: string) => void;
}) => (
  <ul>
    {upload?.errors.map((entry) => {
      const deleting = upload.pending.some(
        (pending) => pending.promptId === entry.promptId && pending.deleting
      );
      return (
        <li key={`${entry.promptId}:${entry.code}`}>
          {deleting ? (
            <p>Deletion pending</p>
          ) : (
            <button type="button" onClick={() => onOpen(entry.promptId)}>
              Open retained prompt
            </button>
          )}
          <RejectedChange entry={entry} deleting={deleting} />
        </li>
      );
    })}
  </ul>
);
const incomingExplanation = (error: string) => {
  if (error === "account_suspended") {
    return "Contact your instance operator. Suspension does not delete your local library.";
  }
  if (error === "snapshot_required") {
    return "This library needs a recovery download.";
  }
  return "Synchronization retries when the connection and account are available.";
};
const IncomingError = ({ changes }: { changes?: ChangeStatus }) =>
  changes?.error ? (
    <p>
      Incoming updates are paused. Saved local work and drafts are retained.{" "}
      {incomingExplanation(changes.error)}
    </p>
  ) : null;
const RecoveryError = ({ code }: { code?: string | null }) =>
  code ? (
    <p>
      Search preparation could not finish.{" "}
      {upgradeRecoveryMessage(code) ??
        "Check storage access and restart pr0 to retry. Browsing and copying remain available; primary prompts and pending changes are preserved."}
    </p>
  ) : null;
const UploadError = ({ code }: { code?: string | null }) =>
  code ? (
    <p>
      {upgradeRecoveryMessage(code) ??
        (code === "incompatible_instance"
          ? "Update pr0 or check your instance address before syncing. Local work is preserved."
          : "Local work is preserved. Synchronization will retry automatically when the connection and account are available.")}
    </p>
  ) : null;
const acceptedDownloadLabel = (upload: UploadStatus) => {
  if (upload.errors.some((entry) => entry.code === "recovery_required")) {
    return `${upload.awaitingDownload} previously accepted variants are retained locally. The server was restored; review them because their earlier acknowledgement does not prove they survived the restore.`;
  }
  return `${upload.awaitingDownload} accepted operations are saved to server. Downloading current records.`;
};
const TransferDetails = ({
  status,
  upload,
  changes,
}: {
  status?: DownloadStatus;
  upload?: UploadStatus;
  changes?: ChangeStatus;
}) => (
  <>
    {changes?.updating ||
    !status?.complete ||
    status?.replacement ||
    upload?.awaitingDownload ? (
      <p>
        Updating this device&apos;s library… Saved local work and open drafts
        are retained.
      </p>
    ) : null}
    <RecoveryError code={status?.recoveryError} />
    <IncomingError changes={changes} />
    {upload?.attentionError ? (
      <p>
        Could not refresh review notices. Previously downloaded reviews remain
        available. Synchronization will retry.
      </p>
    ) : null}
    {upload?.awaitingDownload ? <p>{acceptedDownloadLabel(upload)}</p> : null}
    <UploadError code={upload?.error} />
    {upload?.retryAfterMs ? (
      <p>Retry available in {Math.ceil(upload.retryAfterMs / 1000)} seconds.</p>
    ) : null}
  </>
);
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
  const details = useSyncDetails();
  const pendingChanges = status?.pendingChanges ?? 0;
  const label = organizationAttention
    ? "Changes need attention · Changes waiting"
    : (admissionLabel(changes, upload, pendingChanges) ??
      incomingLabel(
        status,
        signedIn,
        upload,
        changes,
        uploadLabel(signedIn, offline, pendingChanges, upload)
      ));
  return (
    <details ref={details}>
      <summary>{saveFailure ? "Not saved · Unsaved draft" : label}</summary>
      {saveFailure ? (
        <p>
          {label}. The draft could not be saved. Keep the editor open to retry
          or copy its text; it may be lost after closing.
        </p>
      ) : null}
      <p>
        {pendingChanges} pending changes. Saved local changes await
        synchronization.
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
        Retry sync
      </button>
      {status &&
      (status.downloaded >= 9000 || status.textBytes >= 94_371_840) ? (
        <p>
          Your library is near its capacity. Archiving does not free capacity.
        </p>
      ) : null}
      {children}
    </details>
  );
};
