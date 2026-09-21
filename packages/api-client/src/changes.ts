// oxlint-disable eslint/no-await-in-loop -- Bound the response stream before parsing.
import {
  changeLimits,
  changePageSchema,
  changeRequestSchema,
} from "@pr0/api-contract/changes";
import type { ChangeRequest } from "@pr0/api-contract/changes";
import { promptErrorSchema } from "@pr0/api-contract/prompts";
import type { LibraryScope } from "@pr0/api-contract/prompts";

import { PromptApiError } from "./prompts";

export const createChangeClient = (
  origin: string,
  scope: LibraryScope & { epoch: string },
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch
) => ({
  poll: async (input: ChangeRequest = {}, cancellation?: AbortSignal) => {
    const request = changeRequestSchema.parse(input);
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(request)) {
      if (value !== undefined) {
        parameters.set(key, String(value));
      }
    }
    const signal = AbortSignal.any([
      AbortSignal.timeout(35_000),
      ...(cancellation ? [cancellation] : []),
    ]);
    signal.throwIfAborted();
    const response = await fetcher(
      `${origin.replace(/\/$/u, "")}/api/v1/sync/changes?${parameters}`,
      {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal,
      }
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("invalid_response");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cancelReader = async () => {
      try {
        await reader.cancel();
      } catch {
        /* Preserve the original stream error. */
      }
    };
    const cancel = () => {
      void cancelReader();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) {
          break;
        }
        size += value.length;
        if (size > changeLimits.pageBytes) {
          throw new Error("invalid_response");
        }
        chunks.push(value);
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      await cancelReader();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
    if (!response.ok) {
      const detail = promptErrorSchema.safeParse(body);
      const retry = Number(response.headers.get("Retry-After"));
      throw new PromptApiError(
        response.status,
        detail.success
          ? {
              ...detail.data,
              retryAfter:
                detail.data.retryAfter ?? (retry > 0 ? retry : undefined),
            }
          : undefined
      );
    }
    const page = changePageSchema.parse(body);
    if (
      page.instanceId !== scope.instanceId ||
      page.accountId !== scope.accountId ||
      page.epoch !== scope.epoch ||
      (request.after !== undefined && page.fromRevision !== request.after)
    ) {
      throw new Error("change_identity_mismatch");
    }
    return page;
  },
});
