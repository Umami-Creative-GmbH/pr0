"use client";

import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { useQuery } from "@tanstack/react-query";

import { retryPromptRead, promptRetryDelay } from "./prompt-query";

export const useOrganization = (library: PrivateLibrary) => {
  const client = useApiClient();
  const organizationKey = [
    "organization",
    client.baseUrl,
    library.instance.id,
    library.account.id,
  ];
  const organization = useQuery({
    queryKey: organizationKey,
    queryFn: ({ signal }) =>
      client.getOrganization(signal, {
        instanceId: library.instance.id,
        accountId: library.account.id,
      }),
    retry: retryPromptRead,
    retryDelay: promptRetryDelay,
    refetchInterval: 5000,
  });
  return { organization, organizationKey };
};
