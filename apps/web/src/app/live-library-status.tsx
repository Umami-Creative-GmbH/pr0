import { LastChecked } from "@pr0/ui/components/last-checked";
import type { ReactNode } from "react";

import { useLibraryAttention } from "./library-attention";
import type { LiveStatus } from "./live-change-coordinator";

export const LiveLibraryStatus = ({
  status,
  children,
}: {
  status: LiveStatus;
  children?: ReactNode;
}) => {
  const entries = Object.entries(useLibraryAttention());
  const unsaved = entries.some(([, entry]) => entry.unsaved);
  const attentionLabel = unsaved
    ? "Changes need attention · Unsaved work in this tab"
    : "Changes need attention";
  return (
    <details>
      <summary>{entries.length ? attentionLabel : status.label}</summary>
      {entries.length ? (
        <>
          <p>{status.label}</p>
          {unsaved ? (
            <p>
              This work is retained only in the open tab. Closing or reloading
              may lose it.
            </p>
          ) : null}
          <ul>
            {entries.map(([id, entry]) => (
              <li key={id}>
                <a href={`#${entry.target}`}>{entry.message}</a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <LastChecked at={status.lastCheckedAt} />
      <p>
        Open drafts stay in this tab while incoming changes update your library.
      </p>
      {children}
    </details>
  );
};
