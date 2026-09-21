import type { ChangeStatus } from "@pr0/api-contract/changes";
import type { UploadStatus } from "@pr0/api-contract/local-prompts";

import type { DownloadStatus } from "./library-client";
import { uploadLabel, uploadFailureMessage } from "./upload-status";

const LastChecked = ({ at }: { at?: string | null }) =>
  at ? (
    <p>
      Last checked for updates{" "}
      <time dateTime={at}>{new Date(at).toLocaleString()}</time>.
    </p>
  ) : (
    <p>Not yet checked for updates.</p>
  );

const incomingLabel = (
  status: DownloadStatus | undefined,
  signedIn: boolean,
  upload: UploadStatus | undefined,
  changes: ChangeStatus | undefined,
  label: string
) => {
  if (!status?.pendingChanges && !upload?.error) {
    if (!signedIn || changes?.error === "authentication_required") {
      return "Sign in to sync";
    } else if (changes?.error === "network_unavailable") {
      return "Offline";
    } else if (changes?.error === "snapshot_required") {
      return "Library recovery required";
    } else if (changes?.error) {
      return "Couldn't check for updates";
    } else if (changes?.updating || !status?.complete) {
      return "Updating this device's library…";
    } else if (changes?.lastCheckedAt) {
      return "Up to date at last check";
    }
  }
  return label;
};
const IncomingError = ({ changes }: { changes?: ChangeStatus }) =>
  changes?.error ? (
    <p>
      Incoming updates are paused. Saved local work and drafts are retained.{" "}
      {changes.error === "snapshot_required"
        ? "This library needs a recovery download."
        : "Synchronization retries when the connection and account are available."}
    </p>
  ) : null;
export const LocalLibraryStatus = ({
  status,
  signedIn,
  offline,
  upload,
  changes,
  onOpen,
  onRetry,
}: {
  status?: DownloadStatus;
  signedIn: boolean;
  offline: boolean;
  upload?: UploadStatus;
  changes?: ChangeStatus;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) => {
  const label = incomingLabel(
    status,
    signedIn,
    upload,
    changes,
    uploadLabel(signedIn, offline, status?.pendingChanges ?? 0, upload)
  );
  return (
    <details>
      <summary>{label}</summary>
      <p>
        {status?.pendingChanges ?? 0} pending changes. Saved local changes await
        synchronization.
      </p>
      <LastChecked at={changes?.lastCheckedAt} />
      <IncomingError changes={changes} />
      {upload?.awaitingDownload ? (
        <p>
          {upload.awaitingDownload} accepted operations are saved to server.
          Downloading current records.
        </p>
      ) : null}
      {upload?.error ? (
        <p>
          {upload.error === "incompatible_instance"
            ? "Update pr0 or check your instance address before syncing. Local work is preserved."
            : "Local work is preserved. Synchronization will retry automatically when the connection and account are available."}
        </p>
      ) : null}
      {upload?.retryAfterMs ? (
        <p>
          Retry available in {Math.ceil(upload.retryAfterMs / 1000)} seconds.
        </p>
      ) : null}
      {upload?.errors.length ? (
        <ul>
          {upload.errors.map((entry) => (
            <li key={`${entry.promptId}:${entry.code}`}>
              <button type="button" onClick={() => onOpen(entry.promptId)}>
                Open retained prompt
              </button>{" "}
              {uploadFailureMessage(entry.code)}
            </li>
          ))}
        </ul>
      ) : null}
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
    </details>
  );
};
