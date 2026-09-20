"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

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
  if (conflicts.isError) {
    return (
      <div role="alert">
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
  if (!notices.length) {
    return null;
  }
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer focus-visible:outline-2">
        Conflicts to review
      </summary>
      <p className="my-3">
        Competing edits were preserved as independent prompts. Both texts remain
        available.
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
              <button
                className={buttonClass}
                onClick={() => onOpen(notice.originalId)}
                type="button"
              >
                Open original
              </button>
              <button
                className={buttonClass}
                onClick={() => onOpen(notice.copyId)}
                type="button"
              >
                Open conflict copy
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
