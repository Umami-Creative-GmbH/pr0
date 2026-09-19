import { healthPath, healthResponseSchema } from "@pr0/api-contract/health";

const trailingSlashes = /\/+$/u;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetcher?: (input: string, init: RequestInit) => Promise<Response>;
}

export const createApiClient = ({
  baseUrl = "",
  fetcher = globalThis.fetch,
}: ApiClientOptions = {}) => {
  const normalizedBaseUrl = baseUrl.replace(trailingSlashes, "");

  return {
    baseUrl: normalizedBaseUrl,
    async getHealth(signal?: AbortSignal) {
      const response = await fetcher(`${normalizedBaseUrl}${healthPath}`, {
        headers: { Accept: "application/json" },
        signal,
      });

      if (!response.ok) {
        throw new ApiError(response.status);
      }

      return healthResponseSchema.parse(await response.json());
    },
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;
