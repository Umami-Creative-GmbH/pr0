import type { UploadStatus } from "@pr0/api-contract/local-prompts";

import type { DownloadStatus } from "./library-client";
import { uploadLabel, uploadFailureMessage } from "./upload-status";

export const DownloadProgress = ({
  status,
  signedIn,
}: {
  status?: DownloadStatus;
  signedIn: boolean;
}) => (
  <>
    <output className="block">
      {status?.complete
        ? `Library downloaded at revision ${status.revision}. Available offline.`
        : `Downloading library: ${status?.downloaded ?? 0} prompts available. The offline library is incomplete.`}
    </output>
    {status && status.totalPages > 0 ? (
      <progress
        aria-label="Library download progress"
        max={status.totalPages}
        value={status.appliedPages}
      />
    ) : null}
    {signedIn ? null : (
      <p>Sign in to resume downloading. Downloaded prompts remain available.</p>
    )}
  </>
);

const LastChecked = ({ at }: { at?: string | null }) =>
  at ? (
    <p>
      Last checked for updates{" "}
      <time dateTime={at}>{new Date(at).toLocaleString()}</time>.
    </p>
  ) : (
    <p>Not yet checked for updates.</p>
  );

export const LocalLibraryStatus = ({
  status,
  signedIn,
  offline,
  upload,
  onOpen,
  onRetry,
}: {
  status?: DownloadStatus;
  signedIn: boolean;
  offline: boolean;
  upload?: UploadStatus;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) => {
  const label = uploadLabel(
    signedIn,
    offline,
    status?.pendingChanges ?? 0,
    upload
  );
  return (
    <details>
      <summary>{label}</summary>
      <p>
        {status?.pendingChanges ?? 0} pending changes. Saved local changes await
        synchronization.
      </p>
      <LastChecked at={upload?.lastCheckedAt} />
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
