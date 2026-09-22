"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { MutationEnvelope } from "@pr0/api-contract/prompts";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useReportAttention } from "./library-attention";
import { retryPromptRead, promptRetryDelay } from "./prompt-query";

export const OrganizationAdjustments = ({
  library,
}: {
  library: PrivateLibrary;
}) => {
  const t = useTranslations();

  const client = useApiClient();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef(new Map<string, MutationEnvelope>());
  const query = useInfiniteQuery({
    queryKey: [
      "adjustments",
      client.baseUrl,
      library.instance.id,
      library.account.id,
    ],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      client.getAdjustments({ cursor: pageParam || undefined }, signal, {
        instanceId: library.instance.id,
        accountId: library.account.id,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: retryPromptRead,
    retryDelay: promptRetryDelay,
  });
  const notices = query.data?.pages.flatMap((page) => page.notices) ?? [];
  useReportAttention(
    query.isError
      ? t("couldNotRefreshOrganizationNoticesRetryNoticesInDetails")
      : "",
    "organization-adjustments",
    false
  );
  const review = async (notice: (typeof notices)[number]) => {
    if (busy) {
      return;
    }
    setBusy(true);
    const envelope = pending.current.get(notice.id) ?? {
      protocolVersion: 1 as const,
      instanceId: library.instance.id,
      accountId: library.account.id,
      epoch: library.epoch,
      installationId: crypto.randomUUID(),
      operations: [
        {
          kind: "organization.review" as const,
          operationId: crypto.randomUUID(),
          promptId: notice.promptId,
          noticeId: notice.id,
          baseRevision: notice.revision,
          dependsOn: [],
        },
      ],
    };
    pending.current.set(notice.id, envelope);
    try {
      const result = await client.mutatePrompts(envelope);
      if (result.results[0]?.status === "accepted") {
        heading.current?.focus();
        setMessage(t("organizationNoticeReviewedYourPromptsWereKept"));
        await query.refetch();
        pending.current.delete(notice.id);
      } else {
        setMessage(t("reviewCouldNotBeSavedRetryYourPromptsWereKept"));
      }
    } catch {
      setMessage(t("reviewCouldNotBeConfirmedRetryWhenConnectedYourPrompts"));
    }
    setBusy(false);
  };
  if (!notices.length && !query.isError && !message) {
    return null;
  }
  return (
    <section
      id="organization-adjustments"
      aria-label={t("organizationAdjustments")}
      className="space-y-3 rounded border p-3"
    >
      <h3 ref={heading} tabIndex={-1}>
        {t("organizationAdjustmentsToReview")}
      </h3>
      <output>
        <LocalizedMessage value={message} />
      </output>
      {query.isError ? (
        <p>
          {t("couldNotRefreshOrganizationNotices")}{" "}
          <button
            type="button"
            onClick={() => {
              void query.refetch();
            }}
          >
            {t("retryNotices")}
          </button>
        </p>
      ) : null}
      <ul>
        {notices.map((notice) => (
          <li key={notice.id}>
            <p>
              <LocalizedMessage value={notice.message} />
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void review(notice);
              }}
            >
              {t("markAdjustmentReviewed")}
            </button>
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t("moreAdjustments")}
        </button>
      ) : null}
    </section>
  );
};
