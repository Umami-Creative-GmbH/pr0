"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";

import type { ApiClient } from "./client";
import { createApiClient } from "./client";

const ApiContext = createContext<ApiClient | null>(null);

// The API origin is fixed for a provider's lifetime. Remount to switch backends.
export const ApiProvider = ({
  children,
  baseUrl = "",
}: {
  children: ReactNode;
  baseUrl?: string;
}) => {
  // oxlint-disable-next-line react/hook-use-state -- Keep one cache per provider; never replace it during rendering.
  const [queryClient] = useState(() => new QueryClient());
  // oxlint-disable-next-line react/hook-use-state -- The API origin is immutable for this provider's lifetime.
  const [apiClient] = useState(() => createApiClient({ baseUrl }));

  return (
    <ApiContext value={apiClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext>
  );
};

export const useApiClient = () => {
  const client = useContext(ApiContext);
  if (!client) {
    throw new Error("useApiClient must be used inside ApiProvider");
  }
  return client;
};
