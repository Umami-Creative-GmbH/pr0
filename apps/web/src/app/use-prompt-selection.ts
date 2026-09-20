"use client";

import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { Prompt, PromptView } from "@pr0/api-contract/prompts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { retryPromptRead, promptRetryDelay } from "./prompt-query";

const eligible = (
  prompt: Prompt,
  view: PromptView,
  collectionId: string | null
) =>
  (!collectionId || prompt.collectionId === collectionId) &&
  prompt.archived === (view === "archive") &&
  (view !== "favorites" || prompt.favorite);

export const usePromptSelection = ({
  library,
  view,
  collectionId,
  prompts,
  incomplete,
  loading,
}: {
  library: PrivateLibrary;
  view: PromptView;
  collectionId: string | null;
  prompts: { id: string; revision: string }[];
  incomplete: boolean;
  loading: boolean;
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
      !eligible(state.data, view, collectionId)
    );
  };
  const excluded = cachedExcludes(
    requestedId,
    prompts.find((prompt) => prompt.id === requestedId)?.revision
  );
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
