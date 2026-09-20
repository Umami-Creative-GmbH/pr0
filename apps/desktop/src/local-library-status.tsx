import type { DownloadStatus } from "./library-client";

export const LocalLibraryStatus = ({
  status,
  signedIn,
  offline,
}: {
  status?: DownloadStatus;
  signedIn: boolean;
  offline: boolean;
}) => {
  let label = "Library status";
  if (status?.pendingChanges) {
    label = signedIn
      ? "Changes waiting to sync"
      : "Sign in to sync · Changes waiting";
    if (offline && signedIn) {
      label = "Offline · Changes waiting to sync";
    }
  } else if (offline) {
    label = "Offline";
  }
  return (
    <details>
      <summary>{label}</summary>
      <p>
        {status?.pendingChanges ?? 0} pending changes. Saved local changes await
        synchronization.
      </p>
      <p>Not yet checked for updates.</p>
      {status &&
      (status.downloaded >= 9000 || status.textBytes >= 94_371_840) ? (
        <p>
          Your library is near its capacity. Archiving does not free capacity.
        </p>
      ) : null}
    </details>
  );
};
