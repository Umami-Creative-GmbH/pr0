import { LastChecked } from "@pr0/ui/components/last-checked";
import { AppBarStatus, AppMenu } from "@pr0/ui/components/wayfinder-shell";
import { statusTone } from "@pr0/ui/lib/present";
import type { ReactNode } from "react";

import { useLibraryAttention } from "./library-attention";
import type { LiveStatus } from "./live-change-coordinator";

/** Real synchronization and attention state, shown in the app bar. */
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
    <AppBarStatus>
      <AppMenu
        variant="sync"
        summary={
          <>
            <span
              className="wf-dot"
              data-tone={statusTone(status.label, entries.length > 0)}
            />
            <span>{entries.length ? attentionLabel : status.label}</span>
          </>
        }
      >
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
          Open drafts stay in this tab while incoming changes update your
          library.
        </p>
        {children}
      </AppMenu>
    </AppBarStatus>
  );
};
