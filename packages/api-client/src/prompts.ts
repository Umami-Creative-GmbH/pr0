import {
  sortedTagIds,
  mutationEnvelopeSchema,
  organizationSnapshotSchema,
  mutationResponseSchema,
  promptErrorSchema,
  promptIdentitySchema,
  promptListInputSchema,
  promptBrowseInputSchema,
  promptPageSchema,
  promptSchema,
  conflictPageSchema,
  organizationImpactInputSchema,
  organizationImpactSchema,
  organizationReviewSchema,
  organizationStatesSchema,
} from "@pr0/api-contract/prompts";
import type {
  LibraryScope,
  MutationEnvelope,
  PromptError,
  PromptView,
  PromptSort,
  MutationResult,
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
const cleanupReceiptMatches = (
  entry: Extract<MutationResult, { effect: unknown }>,
  operation: MutationEnvelope["operations"][number]
) => {
  let sourceId: string | null = null;
  if ("collectionId" in operation) {
    sourceId = operation.collectionId;
  }
  if ("tagId" in operation) {
    sourceId = operation.tagId;
  }
  return (
    entry.effect.kind === operation.kind &&
    entry.effect.sourceId === sourceId &&
    entry.effect.targetId ===
      (operation.kind === "tag.merge" ? operation.targetId : null)
  );
};
const receiptMatches = (
  entry: MutationResult,
  operation: MutationEnvelope["operations"][number] | undefined
) => {
  if (!operation) {
    return false;
  }
  if (entry.status === "rejected") {
    return entry.error.operationId === operation.operationId;
  }
  if (entry.operationId !== operation.operationId) {
    return false;
  }
  if ("effect" in entry) {
    return cleanupReceiptMatches(entry, operation);
  }
  if ("tagId" in entry) {
    if (operation.kind !== "tag.create" && operation.kind !== "tag.rename") {
      return false;
    }
    if (!("tagId" in operation) || entry.tagId !== operation.tagId) {
      return false;
    }
    if (operation.kind === "tag.rename") {
      return (
        entry.resolvedTagId === operation.tagId && entry.outcome === "renamed"
      );
    }
    return (
      entry.outcome === "existing" ||
      (entry.outcome === "created" && entry.resolvedTagId === operation.tagId)
    );
  }
  if ("collectionId" in entry) {
    return (
      (operation.kind === "collection.create" ||
        operation.kind === "collection.rename") &&
      entry.collectionId === operation.collectionId
    );
  }
  return (
    "promptId" in operation &&
    entry.promptId === operation.promptId &&
    (operation.kind !== "prompt.use" || entry.usedAt !== undefined)
  );
};
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
    async getOrganizationImpact(
      input: {
        kind: "collection.delete" | "tag.delete" | "tag.merge";
        sourceId: string;
        targetId?: string;
      },
      signal?: AbortSignal,
      scope?: LibraryScope
    ) {
      const parsed = organizationImpactInputSchema.parse(input);
      const params = new URLSearchParams({
        kind: parsed.kind,
        sourceId: parsed.sourceId,
      });
      if (parsed.targetId) {
        params.set("targetId", parsed.targetId);
      }
      const result = organizationImpactSchema.parse(
        await request(`library/organization/impact?${params}`, signal)
      );
      assertScope(result, scope);
      if (
        result.effect.kind !== input.kind ||
        result.effect.sourceId !== input.sourceId ||
        result.effect.targetId !== (input.targetId ?? null)
      ) {
        throw new Error("Organization impact identity mismatch.");
      }
      return result;
    },
    async getOrganizationReview(
      operationId: string,
      offset = 0,
      signal?: AbortSignal,
      scope?: LibraryScope
    ) {
      promptIdentitySchema.parse(operationId);
      if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
        throw new Error("Invalid review offset.");
      }
      const result = organizationReviewSchema.parse(
        await request(
          `library/organization/operations/${operationId}?offset=${offset}`,
          signal
        )
      );
      assertScope(result, scope);
      if (result.operationId !== operationId) {
        throw new Error("Organization review identity mismatch.");
      }
      return result;
    },
    async getOrganizationStates(
      ids: string[],
      signal?: AbortSignal,
      scope?: LibraryScope
    ) {
      if (!ids.length || ids.length > 1000) {
        throw new Error("Invalid organization identity count.");
      }
      for (const id of ids) {
        promptIdentitySchema.parse(id);
      }
      const result = organizationStatesSchema.parse(
        await request(
          `library/organization/states?${new URLSearchParams({ ids: ids.join(",") })}`,
          signal
        )
      );
      assertScope(result, scope);
      const requestedIds = new Set(ids);
      if (result.states.some((state) => !requestedIds.has(state.id))) {
        throw new Error("Organization state identity mismatch.");
      }
      return result;
    },
    async getOrganization(signal?: AbortSignal, scope?: LibraryScope) {
      const snapshot = organizationSnapshotSchema.parse(
        await request("library/organization", signal)
      );
      assertScope(snapshot, scope);
      return snapshot;
    },
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
      input: {
        query?: string;
        sort?: PromptSort;
        cursor?: string;
        limit?: number;
        view?: PromptView;
        viewCollectionId?: string;
        favorite?: boolean;
        collectionId?: string;
        tagIds?: string[];
      } = {},
      signal?: AbortSignal,
      scope?: LibraryScope
    ) {
      const parsed = promptBrowseInputSchema.parse(input);
      const params = new URLSearchParams({
        limit: String(parsed.limit),
        view: parsed.view,
      });
      if (parsed.query) {
        params.set("query", parsed.query);
      }
      if (parsed.sort) {
        params.set("sort", parsed.sort);
      }
      if (parsed.cursor) {
        params.set("cursor", parsed.cursor);
      }
      if (parsed.collectionId) {
        params.set("collectionId", parsed.collectionId);
      }
      if (parsed.viewCollectionId) {
        params.set("viewCollectionId", parsed.viewCollectionId);
      }
      if (parsed.favorite !== undefined) {
        params.set("favorite", String(parsed.favorite));
      }
      if (parsed.tagIds?.length) {
        params.set("tagIds", sortedTagIds(parsed.tagIds).join(","));
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
        result.results.some(
          (entry, index) => !receiptMatches(entry, envelope.operations[index])
        )
      ) {
        throw new Error(
          "The server response does not match these operations. Retry to confirm saving."
        );
      }
      return result;
    },
  };
};
