import { createHmac, timingSafeEqual } from "node:crypto";

import { organizationSearch } from "@pr0/api-contract/organization";
import {
  searchNormalizationVersion,
  sortedTagIds,
} from "@pr0/api-contract/prompts";
import { z } from "zod";

import { configuration } from "./config";
import { invalidPromptRequest, PromptFailureError } from "./prompt-errors";
import type { SearchInput, SearchScope } from "./search-types";

const schema = z.strictObject({
  binding: z.string(),
  revision: z.string(),
  offset: z.number().int().min(0).max(10_000),
});
const sign = (value: string) =>
  createHmac("sha256", configuration().authSecret)
    .update(`search-page-v1:${value}`)
    .digest("base64url");
export const searchCursor = (scope: SearchScope, input: SearchInput) => {
  const query = organizationSearch(input.query);
  const binding = sign(
    JSON.stringify([
      scope.instance,
      scope.account,
      scope.epoch,
      searchNormalizationVersion,
      query,
      input.sort ?? (query ? "relevance" : "recently-modified"),
      input.view,
      input.collectionId ?? null,
      sortedTagIds(input.tagIds ?? []),
      input.limit,
    ])
  );
  let offset = 0;
  if (input.cursor) {
    const parts = input.cursor.split(".");
    const [payload = "", signature = ""] = parts;
    const expected = sign(payload);
    if (
      parts.length !== 2 ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      throw invalidPromptRequest();
    }
    let decoded;
    try {
      decoded = schema.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString())
      );
    } catch {
      throw invalidPromptRequest();
    }
    if (decoded.binding !== binding) {
      throw invalidPromptRequest();
    }
    if (decoded.revision !== scope.revision) {
      throw new PromptFailureError(
        {
          code: "results_changed",
          message:
            "Your library changed. Restarting results from the first page.",
          retryable: true,
        },
        409
      );
    }
    ({ offset } = decoded);
  }
  return {
    offset,
    next: (nextOffset: number | null) => {
      if (nextOffset === null) {
        return null;
      }
      const payload = Buffer.from(
        JSON.stringify({
          binding,
          revision: scope.revision,
          offset: nextOffset,
        })
      ).toString("base64url");
      return `${payload}.${sign(payload)}`;
    },
  };
};
