"use client";

import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { organizationSearch } from "@pr0/api-contract/organization";
import type {
  Prompt,
  PromptView,
  Collection,
  Tag,
} from "@pr0/api-contract/prompts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { retryPromptRead, promptRetryDelay } from "./prompt-query";

const eligible = (
  prompt: Prompt,
  view: PromptView,
  collectionId: string | null,
  tagIds: string[],
  viewCollectionId: string | null,
  favorite: boolean
) =>
  tagIds.every((id) => new Set(prompt.tagIds).has(id)) &&
  (!collectionId || prompt.collectionId === collectionId) &&
  (!viewCollectionId || prompt.collectionId === viewCollectionId) &&
  (!favorite || prompt.favorite) &&
  prompt.archived === (view === "archive") &&
  (view !== "favorites" || prompt.favorite);

export const usePromptSelection = ({
  library,
  view,
  collectionId,
  viewCollectionId,
  favorite,
  organization,
  tagIds,
  query,
  prompts,
  incomplete,
  loading,
  libraryRevision,
}: {
  library: PrivateLibrary;
  view: PromptView;
  collectionId: string | null;
  viewCollectionId: string | null;
  favorite: boolean;
  organization: { collections: Collection[]; tags: Tag[] } | undefined;
  tagIds: string[];
  query: string;
  prompts: { id: string; revision: string }[];
  incomplete: boolean;
  loading: boolean;
  libraryRevision?: string;
}) => {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const requestedId = selected ?? prompts[0]?.id ?? "";
  const detail = useQuery({
    queryKey: [
      "prompt",
      client.baseUrl,
      library.instance.id,
      library.account.id,
      requestedId,
    ],
    queryFn: ({ signal }) =>
      client.getPrompt(requestedId, signal, {
        instanceId: library.instance.id,
        accountId: library.account.id,
      }),
    enabled: Boolean(requestedId),
    retry: retryPromptRead,
    retryDelay: promptRetryDelay,
  });
  const selectedText = useMemo(() => {
    const prompt = detail.data;
    if (!prompt) {
      return [];
    }
    const selectedTags = new Set(prompt.tagIds);
    return [
      prompt.title,
      prompt.description,
      prompt.content,
      organization?.collections.find(
        (entry) => entry.id === prompt.collectionId
      )?.name ?? "",
      ...(organization?.tags.flatMap((tag) =>
        selectedTags.has(tag.id) ? [tag.name] : []
      ) ?? []),
    ].map(organizationSearch);
  }, [detail.data, organization]);
  const detailRevision = detail.data?.libraryRevision;
  const refreshDetail = detail.refetch;
  useEffect(() => {
    if (
      libraryRevision &&
      detailRevision &&
      BigInt(libraryRevision) > BigInt(detailRevision)
    ) {
      // oxlint-disable-next-line react-doctor/query-no-query-in-effect -- A newer list revision invalidates a selected identity even when it moved beyond the loaded page.
      void refreshDetail();
    }
  }, [libraryRevision, detailRevision, refreshDetail]);
  const terms = organizationSearch(query).split(" ").filter(Boolean);
  const cachedExcludes = (id: string, revision = "0") => {
    const state = queryClient.getQueryState<Prompt>([
      "prompt",
      client.baseUrl,
      library.instance.id,
      library.account.id,
      id,
    ]);
    if (state?.error instanceof PromptApiError && state.error.status === 404) {
      return true;
    }
    return Boolean(
      state?.data &&
      BigInt(state.data.revision) >= BigInt(revision) &&
      !eligible(
        state.data,
        view,
        collectionId,
        tagIds,
        viewCollectionId,
        favorite
      )
    );
  };
  const excluded =
    cachedExcludes(
      requestedId,
      prompts.find((prompt) => prompt.id === requestedId)?.revision
    ) ||
    (Boolean(detail.data) &&
      !terms.every((term) =>
        selectedText.some((field) => field.includes(term))
      ));
  const remaining = prompts.filter(
    (prompt) => !cachedExcludes(prompt.id, prompt.revision)
  );
  const refreshNeeded = excluded || remaining.length !== prompts.length;
  const keepSelected =
    selected &&
    !excluded &&
    (incomplete || remaining.some((prompt) => prompt.id === selected));
  const selectedId = keepSelected ? selected : (remaining[0]?.id ?? null);
  // Store automatic selection before committing the render, so later ordering changes follow its identity.
  if (!loading && selected !== selectedId) {
    setSelected(selectedId);
  }
  useEffect(() => {
    if (refreshNeeded) {
      void queryClient.resetQueries({
        queryKey: [
          "prompts",
          client.baseUrl,
          library.instance.id,
          library.account.id,
          view,
        ],
      });
    }
  }, [
    refreshNeeded,
    queryClient,
    client.baseUrl,
    library.instance.id,
    library.account.id,
    view,
  ]);
  return { selectedId, setSelected, detail };
};
