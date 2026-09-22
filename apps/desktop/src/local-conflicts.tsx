import {
  localConflictReviewSchema,
  localConflictPageSchema as pageSchema,
} from "@pr0/api-contract/local-prompts";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useLocale, useTranslations } from "@pr0/ui/hooks/use-translations";
/* oxlint-disable react/exhaustive-effect-dependencies -- Native event counters and explicit retries invalidate the persisted notice query. */
import { translate } from "@pr0/ui/lib/i18n";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";

import type { Status } from "./use-auth-session";

export const LocalConflicts = ({
  account,
  refresh,
  onOpen,
  onChanged,
}: {
  account: Status;
  refresh: number;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) => {
  const locale = useLocale();

  const t = useTranslations();

  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<z.infer<typeof pageSchema>>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = pageSchema.parse(
          await invoke("library_conflicts", { offset })
        );
        if (
          result.instanceId !== account.instanceId ||
          result.accountId !== account.accountId
        ) {
          return;
        }
        if (!cancelled) {
          setPage(result);
          setError(
            result.error
              ? translate(
                  "couldNotRefreshConflictNoticesPreviouslyDownloadedReviewsRemainAvailable"
                )
              : ""
          );
        }
      } catch {
        if (!cancelled) {
          setError(
            translate("couldNotLoadConflictReviewSavedPromptsRemainAvailable")
          );
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    account.instanceId,
    account.accountId,
    account.generation,
    offset,
    refresh,
    version,
  ]);
  const review = async (noticeId: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await invoke("library_review_conflict", {
        request: localConflictReviewSchema.parse({
          instanceId: account.instanceId,
          accountId: account.accountId,
          generation: account.generation,
          noticeId,
        }),
      });
      summary.current?.focus();
      setMessage(t("reviewSavedOnThisDevicePromptsAndRetainedTitlesWere"));
      setVersion((value) => value + 1);
      onChanged();
    } catch {
      setMessage(t("reviewWasNotSavedPromptsRemainAvailableRetryTheReview"));
    }
    setBusy(false);
  };
  if (!page?.notices.length && !error && !message && !offset) {
    return null;
  }
  return (
    <details className="wf-notice" data-tone="attention">
      <summary ref={summary}>{t("conflictsToReview")}</summary>
      <p>
        {t("competingEditsWerePreservedIndependentlyReviewingKeepsTheTextIt")}
      </p>
      <output>
        <LocalizedMessage value={message} />
      </output>
      {error ? (
        <p>
          <LocalizedMessage value={error} />{" "}
          <button
            type="button"
            onClick={() => setVersion((value) => value + 1)}
          >
            {t("retryConflictReview")}
          </button>
        </p>
      ) : null}
      <ul className="space-y-3">
        {page?.notices.map((notice) => (
          <li key={notice.id} className="rounded border p-3">
            <p className="break-words whitespace-pre-wrap">
              {t("fullSourceTitle")} {notice.sourceTitle}
            </p>
            <p>
              {t("preserved")}{" "}
              <time dateTime={notice.createdAt}>
                {new Date(notice.createdAt).toLocaleString(locale)}
              </time>
            </p>
            {notice.originalDeleted ? (
              <p>{t("originalPermanentlyDeleted")}</p>
            ) : (
              <>
                {notice.originalArchived ? (
                  <p>{t("originalArchived")}</p>
                ) : null}
                {notice.originalAvailable ? (
                  <button
                    type="button"
                    onClick={() => onOpen(notice.originalId)}
                  >
                    {t("openOriginal")}
                  </button>
                ) : (
                  <p>{t("originalIsNotAvailableOnThisDeviceYet")}</p>
                )}
              </>
            )}
            {notice.copyAvailable ? (
              <button type="button" onClick={() => onOpen(notice.copyId)}>
                {t("openConflictCopy")}
              </button>
            ) : (
              <p>{t("conflictCopyIsNotAvailableOnThisDeviceYetFinish")}</p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void review(notice.id);
              }}
            >
              {notice.originalDeleted ? t("markReviewed") : t("keepBoth")}
            </button>
          </li>
        ))}
      </ul>
      {offset ? (
        <button
          type="button"
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          {t("previousConflicts")}
        </button>
      ) : null}
      {page?.nextOffset !== null && page?.nextOffset !== undefined ? (
        <button
          type="button"
          onClick={() => setOffset(page.nextOffset ?? offset)}
        >
          {t("moreConflicts")}
        </button>
      ) : null}
    </details>
  );
};
