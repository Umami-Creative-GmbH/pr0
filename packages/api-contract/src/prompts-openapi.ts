import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptErrorSchema,
  promptPageSchema,
  promptSchema,
  conflictPageSchema,
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
  "/api/v1/library/conflicts": {
    get: {
      operationId: "listPromptConflicts",
      tags: ["Prompts"],
      security: [{ BrowserSession: [] }],
      description:
        "Durable unreviewed conflict notices, newest revision first with UUID ties. The full source title remains retained and quota-accounted. Scoped signed cursors use the same limit and revision checks as prompt pages; no title or notice expires. Review acknowledgement is reserved for the combined review surface.",
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
          "ConflictPage",
          "Original/copy identities, retained full source titles and server dates."
        ),
        ...errors,
      },
    },
  },
  "/api/v1/library/prompts": {
    get: {
      operationId: "listPrompts",
      tags: ["Prompts"],
      security: [{ BrowserSession: [] }],
      description:
        "View is all (default), favorites or archive. All active views exclude archived prompts; archive contains only archived prompts, favorites additionally requires favorite. Restoring preserves retained state eligibility. Newest first by numeric library revision, then ascending UUID. Summaries omit content. Cursors retain both sort keys and are integrity protected and bound to library, recovery epoch, version, view, page limit and revision. Changed revisions return results_changed; restart the list while preserving selection and drafts.",
      parameters: [
        {
          name: "view",
          in: "query",
          schema: {
            type: "string",
            enum: ["all", "favorites", "archive"],
            default: "all",
          },
        },
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
        "Same-origin browser JSON, at most 4 MiB and 100 ordered operations. Supports prompt.create, prompt.update and prompt.duplicate. Updates may include typed favorite/archived booleans in both base and desired with exact changedFields. Only changed metadata follows server acceptance order; unchanged values preserve concurrent changes. Archive/favorite mutations retain text and usage; actual changes alone advance prompt dates and field revisions. Duplication carries sourceId, a new promptId and the selected full text snapshot in desired. It never rereads source text: later edits do not alter the copy. The source identity must belong to this library, including retained operation identities. Copies are active, unfavorited, with fresh server dates and no usage. The title gains a Unicode-safe (copy) suffix; the full sourceTitle remains stored, returned in detail and quota-accounted after later copy edits. Updates carry baseRevision, full baseline and desired title/description/content, and exactly the changedFields after normalization. Per-field equal desired text is a no-op; independent edits combine. Competing fields retain accepted text in the original and preserve the full incoming variant in one active, unfavorited conflict copy with fresh dates and no usage. An accepted receipt keeps promptId as the requested original and optionally maps conflict.copyId and conflict.noticeId. Unchanged text leaves prompt modification time unchanged. Never use a replayed receipt to replace newer canonical records or unsaved drafts. Successor drafts follow a returned copy identity using the submitted text and accepted revision as their baseline. Each entry commits independently and returns an accepted receipt or explicit rejection. Titles/descriptions trim Unicode White_Space; title/content are nonblank. Reject unpaired surrogates and NUL. Limits: title 200 code points, description 2,000 code points, content 262,144 UTF-8 bytes. Preserve nonblank content exactly; duplicate titles allowed. Library limits: 10,000 prompts and 104,857,600 stored UTF-8 text bytes including title/description/content. Receipts, notices, copies, changes and counters commit atomically. Quota or storage refusal changes none of these. A separate compact canonical fingerprint survives refused effects so the same identity can retry only the same payload; corrections use a new identity after the earlier outcome is known. Full retained source titles count toward text quota, including when derived titles are shortened to fit 200 Unicode code points. Canonical hashing v1 uses decoded normalized fields and fixed field order (not JSON property order); unchanged UUID/payload replays the original receipt, changed payload returns operation_identity_reused. Freeze transmitted payloads until their outcome is known. API admission is 120 requests/min/account; mutation work admission is 1,200/min and 200/10 seconds. All responses are no-store.",
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
    ConflictPage: conflictPageSchema,
    PromptPage: promptPageSchema,
    PromptError: promptErrorSchema,
    MutationEnvelope: mutationEnvelopeSchema,
    MutationResponse: mutationResponseSchema,
  }).map(([name, schema]) => [name, z.toJSONSchema(schema)])
) as Record<string, OpenAPIV3_1.SchemaObject>;
