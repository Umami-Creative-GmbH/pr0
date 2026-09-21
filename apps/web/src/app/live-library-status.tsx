import type { LiveStatus } from "./live-change-coordinator";

export const LiveLibraryStatus = ({ status }: { status: LiveStatus }) => (
  <details>
    <summary>{status.label}</summary>
    {status.lastCheckedAt ? (
      <p>
        Last checked for updates{" "}
        <time dateTime={status.lastCheckedAt}>
          {new Date(status.lastCheckedAt).toLocaleString()}
        </time>
        .
      </p>
    ) : (
      <p>Not yet checked for updates.</p>
    )}
    <p>
      Open drafts stay in this tab while incoming changes update your library.
    </p>
  </details>
);
