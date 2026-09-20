"use client";

import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { useQuery } from "@tanstack/react-query";

import { promptRetryDelay, retryPromptRead } from "./prompt-query";

const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";
export const PromptOriginal = ({
  library,
  id,
  onOpen,
}: {
  library: PrivateLibrary;
  id: string;
  onOpen: (id: string) => void;
}) => {
  const client = useApiClient();
  const original = useQuery({
    queryKey: [
      "prompt",
      client.baseUrl,
      library.instance.id,
      library.account.id,
      id,
    ],
    queryFn: ({ signal }) =>
      client.getPrompt(id, signal, {
        instanceId: library.instance.id,
        accountId: library.account.id,
      }),
    retry: retryPromptRead,
    retryDelay: promptRetryDelay,
  });
  if (
    original.error instanceof PromptApiError &&
    original.error.status === 404
  ) {
    return <p>Original is no longer available.</p>;
  }
  if (original.isError) {
    return (
      <div role="alert">
        <p>Could not check the original. Your draft remains available.</p>
        <button
          className={buttonClass}
          type="button"
          onClick={() => {
            void original.refetch();
          }}
        >
          Retry original
        </button>
      </div>
    );
  }
  if (original.isPending) {
    return <p>Checking original…</p>;
  }
  return (
    <button className={buttonClass} type="button" onClick={() => onOpen(id)}>
      Open original
    </button>
  );
};
