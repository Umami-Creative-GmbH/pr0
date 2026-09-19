import { queryOptions } from "@tanstack/react-query";

import type { ApiClient } from "./client";
import { ApiError } from "./client";

export const healthQueryOptions = (client: ApiClient) =>
  queryOptions({
    queryKey: ["api", client.baseUrl, "health"],
    queryFn: ({ signal }) => client.getHealth(signal),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status < 500) {
        return false;
      }
      return failureCount < 2;
    },
  });
