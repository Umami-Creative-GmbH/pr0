import type { LocalOrganization } from "@pr0/api-contract/local-organization";
import { localConflictReviewSchema } from "@pr0/api-contract/local-prompts";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

import { organizationError } from "./organization-client";
import { OrganizationManager } from "./organization-manager";
import { CapacityDetails } from "./rejected-change";
import type { Status } from "./use-auth-session";

export const OrganizationAttention = ({
  account,
  snapshot,
  onSaved,
  disabled,
  onEditing,
}: {
  account: Status;
  snapshot: LocalOrganization;
  onSaved: () => Promise<void>;
  disabled: boolean;
  onEditing: (value: boolean) => void;
}) => {
  const t = useTranslations();

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const retry = async (entry: LocalOrganization["pending"][number]) => {
    if (!("noticeId" in entry.operation)) {
      return;
    }
    try {
      await invoke(
        entry.operation.kind === "conflict.review"
          ? "library_review_conflict"
          : "library_review_adjustment",
        {
          request: localConflictReviewSchema.parse({
            instanceId: account.instanceId,
            accountId: account.accountId,
            generation: account.generation,
            noticeId: entry.operation.noticeId,
          }),
        }
      );
      setMessage(t("reviewQueuedForRetryPromptTextIsRetained"));
      await onSaved();
    } catch {
      setMessage(t("couldNotRetryTheReviewLocalWorkIsRetained"));
    }
  };
  const rejected = snapshot.pending.filter((entry) => entry.error);
  if (!rejected.length && !open) {
    return null;
  }
  return (
    <section aria-label={t("organizationChangesNeedAttention")}>
      <h3>{t("changesNeedAttention")}</h3>
      <output>
        <LocalizedMessage value={message} />
      </output>
      <p>{t("organizationChangesAreSavedOnThisDeviceDependentPromptsWait")}</p>
      <ul>
        {rejected.map((entry) => (
          <li key={entry.id}>
            {"name" in entry.operation
              ? entry.operation.name
              : t("organizationChange")}
            : {organizationError(entry.error)}
            <CapacityDetails failure={entry.failure} />
            {entry.operation.kind.endsWith(".review") ? (
              <>
                <p>
                  {t(
                    "reviewAcknowledgementIsWaitingReviewingNeverRemovesPromptText"
                  )}
                </p>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    void retry(entry);
                  }}
                >
                  {t("retryReview")}
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          onEditing(true);
        }}
      >
        {t("renameOrCorrectOrganization")}
      </button>
      {open ? (
        <OrganizationManager
          account={account}
          snapshot={snapshot}
          initialTab="collections"
          onSaved={onSaved}
          onClose={() => {
            setOpen(false);
            onEditing(false);
          }}
        />
      ) : null}
    </section>
  );
};
