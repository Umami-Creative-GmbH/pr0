"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type {
  ConflictNotice,
  MutationEnvelope,
} from "@pr0/api-contract/prompts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useReportAttention } from "./library-attention";
import { retryPromptRead, promptRetryDelay } from "./prompt-query";

const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
export const PromptConflicts = ({
  library,
  onOpen,
}: {
  library: PrivateLibrary;
  onOpen: (id: string) => void;
}) => {
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
      ? "Could not refresh conflict reviews. Retry the review list."
      : "",
    "conflict-reviews",
    false
  );
  const review = async (notice: ConflictNotice) => {
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
    try {
      const result = await client.mutatePrompts(envelope);
      if (result.results[0]?.status !== "accepted") {
        setMessage(
          "Could not confirm review. Your prompts were kept. Retry the review when connected."
        );
        setBusy(false);
        return;
      }
      summary.current?.focus();
      setMessage(
        "Review recorded. Both prompts and retained titles were kept."
      );
      await queryClient.resetQueries({ queryKey });
      pending.current.delete(notice.id);
    } catch {
      setMessage(
        "Could not confirm review. Your prompts were kept. Retry the review when connected."
      );
    }
    setBusy(false);
  };
  if (conflicts.isError) {
    return (
      <div id="conflict-reviews">
        <p>Could not load conflict notices. Your prompts remain available.</p>
        <button
          className={buttonClass}
          onClick={() => {
            void queryClient.resetQueries({ queryKey });
          }}
          type="button"
        >
          Refresh conflicts
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
        Conflicts to review
      </summary>
      <output>{message}</output>
      <p className="my-3">
        Unseen or competing edits were preserved as independent prompts.
      </p>
      <ul className="space-y-4">
        {notices.map((notice) => (
          <li className="rounded-md border p-3" key={notice.id}>
            <p className="break-words whitespace-pre-wrap">
              Full source title: {notice.sourceTitle}
            </p>
            <p className="my-2 text-sm">
              Preserved{" "}
              <time dateTime={notice.createdAt}>
                {new Date(notice.createdAt).toLocaleString()}
              </time>
            </p>
            <div className="flex flex-wrap gap-3">
              {notice.originalArchived ? <p>Original archived.</p> : null}
              {notice.originalDeleted ? (
                <p>Original permanently deleted.</p>
              ) : (
                <button
                  className={buttonClass}
                  onClick={() => onOpen(notice.originalId)}
                  type="button"
                >
                  Open original
                </button>
              )}
              {notice.copyDeleted ? (
                <p>Conflict copy permanently deleted.</p>
              ) : (
                <button
                  className={buttonClass}
                  onClick={() => onOpen(notice.copyId)}
                  type="button"
                >
                  Open conflict copy
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
                  ? "Mark reviewed"
                  : "Keep both"}
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
          More conflicts
        </button>
      ) : null}
    </details>
  );
};
