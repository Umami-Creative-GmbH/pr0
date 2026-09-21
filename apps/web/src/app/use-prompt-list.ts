"use client";

import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { PromptSort, PromptView } from "@pr0/api-contract/prompts";
import { searchNormalizationVersion } from "@pr0/api-contract/prompts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { retryPromptRead, promptRetryDelay } from "./prompt-query";

export const usePromptList = ({
  library,
  view,
  collectionId,
  viewCollectionId,
  favorite,
  tagIds,
  query,
  sort,
  enabled,
}: {
  library: PrivateLibrary;
  view: PromptView;
  collectionId: string | null;
  viewCollectionId: string | null;
  favorite: boolean;
  tagIds: string[];
  query: string;
  sort: PromptSort;
  enabled: boolean;
}) => {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [restarted, setRestarted] = useState(false);
  const queryKey = [
    "prompts",
    client.baseUrl,
    library.instance.id,
    library.account.id,
    view,
    collectionId,
    tagIds,
    query,
    sort,
    viewCollectionId,
    favorite,
    library.epoch,
    searchNormalizationVersion,
  ];
  const list = useInfiniteQuery({
    queryKey,
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      try {
        return await client.getPrompts(
          {
            cursor: pageParam || undefined,
            view,
            collectionId: collectionId ?? undefined,
            viewCollectionId: viewCollectionId ?? undefined,
            favorite: favorite || undefined,
            tagIds,
            query,
            sort,
          },
          signal,
          { instanceId: library.instance.id, accountId: library.account.id }
        );
      } catch (error) {
        if (
          error instanceof PromptApiError &&
          error.detail?.code === "results_changed"
        ) {
          setRestarted(true);
        }
        throw error;
      }
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: (count, error) =>
      !(
        error instanceof PromptApiError &&
        error.detail?.code === "results_changed"
      ) && retryPromptRead(count, error),
    retryDelay: promptRetryDelay,
    enabled,
    refetchOnWindowFocus: true,
    gcTime: 0,
  });
  useEffect(() => {
    if (
      list.error instanceof PromptApiError &&
      list.error.detail?.code === "results_changed"
    ) {
      void queryClient.invalidateQueries({
        queryKey: [
          "prompts",
          client.baseUrl,
          library.instance.id,
          library.account.id,
        ],
      });
    }
  }, [
    list.error,
    queryClient,
    client.baseUrl,
    library.instance.id,
    library.account.id,
  ]);
  return { list, queryKey, restarted };
};
