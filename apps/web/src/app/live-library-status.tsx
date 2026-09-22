import { LastChecked } from "@pr0/ui/components/last-checked";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { AppBarStatus, AppMenu } from "@pr0/ui/components/wayfinder-shell";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
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
  const t = useTranslations();

  const entries = Object.entries(useLibraryAttention());
  const unsaved = entries.some(([, entry]) => entry.unsaved);
  const attentionLabel = unsaved
    ? t("changesNeedAttentionUnsavedWorkInThisTab")
    : t("changesNeedAttention");
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
            <p>
              <LocalizedMessage value={status.label} />
            </p>
            {unsaved ? (
              <p>{t("thisWorkIsRetainedOnlyInTheOpenTabClosing")}</p>
            ) : null}
            <ul>
              {entries.map(([id, entry]) => (
                <li key={id}>
                  <a href={`#${entry.target}`}>
                    <LocalizedMessage value={entry.message} />
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <LastChecked at={status.lastCheckedAt} />
        <p>{t("openDraftsStayInThisTabWhileIncomingChangesUpdate")}</p>
        {children}
      </AppMenu>
    </AppBarStatus>
  );
};
