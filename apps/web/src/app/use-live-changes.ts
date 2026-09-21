"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { startLiveChanges } from "./live-change-coordinator";
import type { LiveStatus } from "./live-change-coordinator";

export const useLiveChanges = (library: PrivateLibrary, enabled: boolean) => {
  const { baseUrl } = useApiClient();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>({
    label: "Updating library…",
    lastCheckedAt: null,
  });
  const { id: accountId } = library.account;
  const { id: instanceId } = library.instance;
  const { epoch } = library;
  useEffect(() => {
    if (enabled) {
      return startLiveChanges({
        baseUrl,
        accountId,
        instanceId,
        epoch,
        queryClient,
        setStatus,
      });
    }
  }, [baseUrl, accountId, instanceId, epoch, queryClient, enabled]);
  return enabled ? status : { ...status, label: "Sign in to sync" };
};
