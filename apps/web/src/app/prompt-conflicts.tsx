"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type {
  ConflictNotice,
  MutationEnvelope,
} from "@pr0/api-contract/prompts";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useDeviceTimeZone } from "@pr0/ui/hooks/use-device-time-zone";
import { useLocale, useTranslations } from "@pr0/ui/hooks/use-translations";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useReportAttention } from "./library-attention";
import { retryPromptRead, promptRetryDelay } from "./prompt-query";

const buttonClass = "wf-btn";
export const PromptConflicts = ({
  library,
  onOpen,
}: {
  library: PrivateLibrary;
  onOpen: (id: string) => void;
}) => {
  const locale = useLocale();
  const timeZone = useDeviceTimeZone();

  const t = useTranslations();

  const client = useApiClient();
  const queryClient = useQueryClient();
  const summary = useRef<HTMLElement>(null);
  const pending = useRef(new Map<string, MutationEnvelope>());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const queryKey = [
    "conflicts",
    client.baseUrl,
    library.instance.id,
    library.account.id,
  ];
  const conflicts = useInfiniteQuery({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      client.getConflicts({ cursor: pageParam || undefined }, signal, {
        instanceId: library.instance.id,
        accountId: library.account.id,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: retryPromptRead,
    retryDelay: promptRetryDelay,
  });
  const notices = conflicts.data?.pages.flatMap((page) => page.notices) ?? [];
  useReportAttention(
    conflicts.isError
      ? t("couldNotRefreshConflictReviewsRetryTheReviewList")
      : "",
    "conflict-reviews",
    false
  );
  const submitReview = async (notice: ConflictNotice) => {
    try {
      const envelope = pending.current.get(notice.id) ?? {
        protocolVersion: 1 as const,
        instanceId: library.instance.id,
        accountId: library.account.id,
        epoch: library.epoch,
        installationId: crypto.randomUUID(),
        operations: [
          {
            kind: "conflict.review" as const,
            operationId: crypto.randomUUID(),
            promptId: notice.copyId,
            noticeId: notice.id,
            baseRevision: notice.revision,
            dependsOn: [],
          },
        ],
      };
      pending.current.set(notice.id, envelope);
      const result = await client.mutatePrompts(envelope);
      if (result.results[0]?.status !== "accepted") {
        setMessage(t("couldNotConfirmReviewYourPromptsWereKeptRetryThe"));
        return;
      }
      summary.current?.focus();
      setMessage(t("reviewRecordedBothPromptsAndRetainedTitlesWereKept"));
      await queryClient.resetQueries({ queryKey });
      pending.current.delete(notice.id);
    } catch {
      setMessage(t("couldNotConfirmReviewYourPromptsWereKeptRetryThe"));
    }
  };
  const review = async (notice: ConflictNotice) => {
    if (busy) {
      return;
    }
    setBusy(true);
    await submitReview(notice).finally(() => setBusy(false));
  };
  if (conflicts.isError) {
    return (
      <div id="conflict-reviews">
        <p>{t("couldNotLoadConflictNoticesYourPromptsRemainAvailable")}</p>
        <button
          className={buttonClass}
          onClick={() => {
            void queryClient.resetQueries({ queryKey });
          }}
          type="button"
        >
          {t("refreshConflicts")}
        </button>
      </div>
    );
  }
  if (!notices.length && !message) {
    return null;
  }
  return (
    <details id="conflict-reviews" className="rounded-lg border p-4">
      <summary ref={summary} className="cursor-pointer focus-visible:outline-2">
        {t("conflictsToReview")}
      </summary>
      <output>
        <LocalizedMessage value={message} />
      </output>
      <p className="my-3">
        {t("unseenOrCompetingEditsWerePreservedAsIndependentPrompts")}
      </p>
      <ul className="space-y-4">
        {notices.map((notice) => (
          <li className="rounded-md border p-3" key={notice.id}>
            <p className="break-words whitespace-pre-wrap">
              {t("fullSourceTitle")} {notice.sourceTitle}
            </p>
            <p className="my-2 text-sm">
              {t("preserved")}{" "}
              <time dateTime={notice.createdAt}>
                {new Date(notice.createdAt).toLocaleString(locale, {
                  timeZone,
                })}
              </time>
            </p>
            <div className="flex flex-wrap gap-3">
              {notice.originalArchived ? <p>{t("originalArchived")}</p> : null}
              {notice.originalDeleted ? (
                <p>{t("originalPermanentlyDeleted")}</p>
              ) : (
                <button
                  className={buttonClass}
                  onClick={() => onOpen(notice.originalId)}
                  type="button"
                >
                  {t("openOriginal")}
                </button>
              )}
              {notice.copyDeleted ? (
                <p>{t("conflictCopyPermanentlyDeleted")}</p>
              ) : (
                <button
                  className={buttonClass}
                  onClick={() => onOpen(notice.copyId)}
                  type="button"
                >
                  {t("openConflictCopy")}
                </button>
              )}
              <button
                className={buttonClass}
                type="button"
                disabled={busy}
                onClick={() => {
                  void review(notice);
                }}
              >
                {notice.originalDeleted || notice.copyDeleted
                  ? t("markReviewed")
                  : t("keepBoth")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {conflicts.hasNextPage ? (
        <button
          className={`${buttonClass} mt-3`}
          disabled={conflicts.isFetchingNextPage}
          onClick={() => {
            void conflicts.fetchNextPage();
          }}
          type="button"
        >
          {t("moreConflicts")}
        </button>
      ) : null}
    </details>
  );
};
