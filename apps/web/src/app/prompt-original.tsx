"use client";
import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useQuery } from "@tanstack/react-query";

import { promptRetryDelay, retryPromptRead } from "./prompt-query";

const buttonClass = "wf-btn";
export const PromptOriginal = ({
  library,
  id,
  onOpen,
}: {
  library: PrivateLibrary;
  id: string;
  onOpen: (id: string) => void;
}) => {
  const t = useTranslations();

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
    return <p>{t("originalIsNoLongerAvailable")}</p>;
  }
  if (original.isError) {
    return (
      <div role="alert">
        <p>{t("couldNotCheckTheOriginalYourDraftRemainsAvailable")}</p>
        <button
          className={buttonClass}
          type="button"
          onClick={() => {
            void original.refetch();
          }}
        >
          {t("retryOriginal")}
        </button>
      </div>
    );
  }
  if (original.isPending) {
    return <p>{t("checkingOriginal")}</p>;
  }
  return (
    <button className={buttonClass} type="button" onClick={() => onOpen(id)}>
      {t("openOriginal")}
    </button>
  );
};
