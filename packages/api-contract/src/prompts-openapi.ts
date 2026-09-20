import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptErrorSchema,
  promptPageSchema,
  promptSchema,
} from "./prompts";

const response = (schema: string, description: string) => ({
  description,
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
  },
});
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 422, 429, 503].map((status) => [
    String(status),
    {
      ...response(
        "PromptError",
        "Stable, non-disclosing error; retain the draft. Retry-After is in seconds when supplied."
      ),
      headers: { "Retry-After": { schema: { type: "integer" as const } } },
    },
  ])
);
export const promptPaths = {
  "/api/v1/library/prompts": {
    get: {
      operationId: "listPrompts",
      tags: ["Prompts"],
      security: [{ BrowserSession: [] }],
      description:
        "Newest first by numeric library revision; summaries omit content. Cursors are integrity protected and bound to library, recovery epoch, version, page limit and revision. Changed revisions return results_changed; restart the list while preserving selection and drafts.",
      parameters: [
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
        {
          name: "cursor",
          in: "query",
          schema: { type: "string", maxLength: 2048 },
        },
      ],
      responses: {
        "200": response(
          "PromptPage",
          "Bounded page and exact library quota usage."
        ),
        ...errors,
      },
    },
  },
  "/api/v1/library/prompts/{id}": {
    get: {
      operationId: "getPrompt",
      tags: ["Prompts"],
      security: [{ BrowserSession: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": response(
          "Prompt",
          "Full exact text, UUIDv4 identity, decimal-string revision and UTC server dates."
        ),
        ...errors,
      },
    },
  },
  "/api/v1/sync/mutations": {
    post: {
      operationId: "mutatePrompts",
      tags: ["Prompts"],
      security: [{ BrowserSession: [] }],
      description:
        "Same-origin browser JSON, at most 4 MiB and 100 ordered operations. This slice supports prompt.create only. Each entry commits independently and returns an accepted receipt or explicit rejection. Titles/descriptions trim Unicode White_Space; title/content are nonblank. Reject unpaired surrogates and NUL. Limits: title 200 code points, description 2,000 code points, content 262,144 UTF-8 bytes. Preserve nonblank content exactly; duplicate titles allowed. Library limits: 10,000 prompts and 104,857,600 stored UTF-8 text bytes including title/description/content. Receipts and counters commit atomically. Canonical hashing v1 uses decoded normalized fields and fixed field order (not JSON property order); unchanged UUID/payload replays the original receipt, changed payload returns operation_identity_reused. Freeze transmitted payloads until their outcome is known. API admission is 120 requests/min/account; mutation work admission is 1,200/min and 200/10 seconds. All responses are no-store.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/MutationEnvelope" },
          },
        },
      },
      responses: {
        "200": response(
          "MutationResponse",
          "One result per submitted operation in order; mixed results are not wholly saved."
        ),
        ...errors,
      },
    },
  },
} satisfies OpenAPIV3_1.PathsObject;
// SAFETY: Zod emits JSON Schema 2020-12 supported by OpenAPI 3.1; openapi-types models a narrower subset.
export const promptSchemas = Object.fromEntries(
  Object.entries({
    Prompt: promptSchema,
    PromptPage: promptPageSchema,
    PromptError: promptErrorSchema,
    MutationEnvelope: mutationEnvelopeSchema,
    MutationResponse: mutationResponseSchema,
  }).map(([name, schema]) => [name, z.toJSONSchema(schema)])
) as Record<string, OpenAPIV3_1.SchemaObject>;
