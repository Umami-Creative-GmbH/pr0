import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptErrorSchema,
  promptIdentitySchema,
  promptListInputSchema,
  promptBrowseInputSchema,
  promptPageSchema,
  promptSchema,
  conflictPageSchema,
} from "@pr0/api-contract/prompts";
import type {
  LibraryScope,
  MutationEnvelope,
  PromptError,
  PromptView,
} from "@pr0/api-contract/prompts";

export class PromptApiError extends Error {
  readonly status: number;
  readonly detail?: PromptError;
  constructor(status: number, detail?: PromptError) {
    super(
      detail?.message ??
        "The server could not confirm this request. Keep your draft and retry."
    );
    this.name = "PromptApiError";
    this.status = status;
    this.detail = detail;
  }
}
export const createPromptClient = (
  baseUrl: string,
  fetcher: (input: string, init: RequestInit) => Promise<Response>
) => {
  const assertScope = (actual: LibraryScope, expected?: LibraryScope) => {
    if (
      expected &&
      (actual.accountId !== expected.accountId ||
        actual.instanceId !== expected.instanceId)
    ) {
      throw new PromptApiError(403, {
        code: "forbidden",
        message:
          "Your browser is signed in to a different library. Return to the original account to continue with this draft.",
        retryable: false,
      });
    }
  };
  const request = async (
    path: string,
    signal?: AbortSignal,
    input?: MutationEnvelope
  ) => {
    const headers = new Headers({ Accept: "application/json" });
    if (input) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetcher(`${baseUrl}/api/v1/${path}`, {
      method: input ? "POST" : "GET",
      headers,
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
      body: input ? JSON.stringify(input) : undefined,
    });
    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new PromptApiError(response.status);
      }
      const parsed = promptErrorSchema.safeParse(payload);
      throw new PromptApiError(
        response.status,
        parsed.success ? parsed.data : undefined
      );
    }
    return response.json();
  };
  return {
    async getConflicts(
      input: { cursor?: string; limit?: number } = {},
      signal?: AbortSignal,
      scope?: LibraryScope
    ) {
      const parsed = promptListInputSchema.parse(input);
      const params = new URLSearchParams({ limit: String(parsed.limit) });
      if (parsed.cursor) {
        params.set("cursor", parsed.cursor);
      }
      const result = conflictPageSchema.parse(
        await request(`library/conflicts?${params}`, signal)
      );
      assertScope(result, scope);
      return result;
    },
    async getPrompts(
      input: { cursor?: string; limit?: number; view?: PromptView } = {},
      signal?: AbortSignal,
      scope?: LibraryScope
    ) {
      const parsed = promptBrowseInputSchema.parse(input);
      const params = new URLSearchParams({
        limit: String(parsed.limit),
        view: parsed.view,
      });
      if (parsed.cursor) {
        params.set("cursor", parsed.cursor);
      }
      const result = promptPageSchema.parse(
        await request(`library/prompts?${params}`, signal)
      );
      assertScope(result, scope);
      return result;
    },
    async getPrompt(id: string, signal?: AbortSignal, scope?: LibraryScope) {
      const prompt = promptSchema.parse(
        await request(
          `library/prompts/${promptIdentitySchema.parse(id)}`,
          signal
        )
      );
      assertScope(prompt, scope);
      if (prompt.id !== id) {
        throw new Error(
          "The returned prompt identity does not match the request."
        );
      }
      return prompt;
    },
    async mutatePrompts(input: MutationEnvelope, signal?: AbortSignal) {
      const envelope = mutationEnvelopeSchema.parse(input);
      const result = mutationResponseSchema.parse(
        await request("sync/mutations", signal, envelope)
      );
      if (
        result.results.length !== envelope.operations.length ||
        result.results.some((entry, index) => {
          const operation = envelope.operations[index];
          return entry.status === "accepted"
            ? entry.operationId !== operation?.operationId ||
                entry.promptId !== operation.promptId
            : entry.error.operationId !== operation?.operationId;
        })
      ) {
        throw new Error(
          "The server response does not match these operations. Retry to confirm saving."
        );
      }
      return result;
    },
  };
};
