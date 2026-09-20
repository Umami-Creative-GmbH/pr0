import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptErrorSchema,
  promptPageSchema,
  promptSchema,
  conflictPageSchema,
  organizationSnapshotSchema,
  organizationImpactSchema,
  organizationReviewSchema,
  organizationStatesSchema,
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
  "/api/v1/library/organization/impact": {
    get: {
      operationId: "getOrganizationImpact",
      tags: ["Organization"],
      security: [{ BrowserSession: [] }],
      description:
        "Current named deletion or merge confirmation at one library revision. Merge counts are the distinct union of source and target assignments, including archive. Does not authorize a mutation.",
      parameters: [
        {
          name: "kind",
          in: "query",
          required: true,
          schema: {
            type: "string",
            enum: ["collection.delete", "tag.delete", "tag.merge"],
          },
        },
        {
          name: "sourceId",
          in: "query",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "targetId",
          in: "query",
          description:
            "Required only for tag.merge; must be a different live tag in the same library.",
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": response("OrganizationImpact", "Observed counts and names."),
        ...errors,
      },
    },
  },
  "/api/v1/library/organization/operations/{id}": {
    get: {
      operationId: "getOrganizationReview",
      tags: ["Organization"],
      security: [{ BrowserSession: [] }],
      description:
        "Pages of 100 original affected identities, ordered by UUID. Membership is immutable; current summaries reflect later edits and archive changes, or null after prompt deletion. Offset is stable across live changes. Foreign operations are not found. No prompt content is loaded.",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "offset",
          in: "query",
          schema: { type: "integer", minimum: 0, maximum: 10_000, default: 0 },
        },
      ],
      responses: {
        "200": response(
          "OrganizationReview",
          "Original effect and current affected-prompt states."
        ),
        ...errors,
      },
    },
  },
  "/api/v1/library/organization/states": {
    get: {
      operationId: "getOrganizationStates",
      tags: ["Organization"],
      security: [{ BrowserSession: [] }],
      description:
        "Looks up removed identities only within this library. Merged tags expose an existing final target or null after target deletion. Cycles terminate safely. These aliases never authorize automatic UI filter substitution; unavailable selected identities keep returning no matches.",
      parameters: [
        {
          name: "ids",
          in: "query",
          required: true,
          description: "Comma-separated list of 1–1,000 UUIDv4 identities.",
          schema: { type: "string", maxLength: 36_999 },
        },
      ],
      responses: {
        "200": response(
          "OrganizationStates",
          "Deleted or merged identity states."
        ),
        ...errors,
      },
    },
  },
  "/api/v1/library/organization": {
    get: {
      operationId: "getOrganization",
      tags: ["Organization"],
      security: [{ BrowserSession: [] }],
      description:
        "Complete library snapshot, including unused collections (at most 200) and tags (at most 1,000). Active, archived and total counts describe this snapshot independently of prompt views. Alphabetical ordering uses pr0-search-v1-ucd17 scalar order with UUID ties. No query parameters. Names and counts are returned in a single serialized read at the reported revision.",
      responses: {
        "200": response(
          "OrganizationSnapshot",
          "All collections and tags, counts, revision and shared text usage."
        ),
        ...errors,
      },
    },
  },
  "/api/v1/library/conflicts": {
    get: {
      operationId: "listPromptConflicts",
      tags: ["Prompts"],
      security: [{ BrowserSession: [] }],
      description:
        "Durable unreviewed conflict notices, newest revision first with UUID ties. The full source title remains retained and quota-accounted. Scoped signed cursors use the same limit and revision checks as prompt pages; no title or notice expires. originalDeleted reports a permanent deletion marker for the original, so clients offer the surviving copy without promising original restoration. Review acknowledgement is reserved for the combined review surface.",
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
        "Optional tagIds is a comma-separated list of library-owned UUIDs (up to 1,000); all selected tags combine by AND, including with view and collectionId. The complete tag set is bound into the signed cursor. Unavailable identities produce no matches. Optional collectionId filters by library-owned identity with AND and is included in the signed cursor scope; absent or foreign identities produce no matches. View is all (default), favorites or archive. All active views exclude archived prompts; archive contains only archived prompts, favorites additionally requires favorite. Restoring preserves retained state eligibility. Newest first by numeric library revision, then ascending UUID. Summaries omit content. Cursors retain both sort keys and are integrity protected and bound to library, recovery epoch, version, view, page limit and revision. Changed revisions return results_changed; restart the list while preserving selection and drafts.",
      parameters: [
        {
          name: "tagIds",
          in: "query",
          description: "Comma-separated tag UUIDs, combined with AND.",
          schema: { type: "string", maxLength: 36_999 },
        },
        {
          name: "collectionId",
          in: "query",
          schema: { type: "string", format: "uuid" },
        },
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
        "Same-origin browser JSON, at most 4 MiB and 100 ordered operations. Tag operations: tag.create and tag.rename carry tagId/name, and return tagId (requested), resolvedTagId (canonical), outcome (created/existing/renamed) plus the ordinary receipt fields. Equivalent creation resolves to the existing identity and preserves its capitalization, without assigning prompts or consuming another slot. Colliding rename returns name_conflict and requires explicit tag.merge approval. collection.delete, tag.delete and tag.merge are singleton requests bounded by 10,000 prompts. They preserve prompts, update assignment dates and revisions, release organization quota and commit one compact bulk change plus a replayable effect receipt and paginated affected identities atomically. tag.merge carries tagId and targetId, keeps target identity/capitalization, combines memberships once and retains a same-library alias. baseRevision must observe source and target name revisions; otherwise results_changed requires renewed confirmation. True deletion clears stale references with organizationNotice; unknown/foreign references remain invalid. Aliases stop at deleted targets and reject cycles. A stale rename cannot rename a merge target. Tags use the same Unicode 17 organization identity and 60-code-point validation as collections. Enforce 1,000 tags and shared text accounting; at capacity, equivalent creation and shorter renames remain valid. prompt.tags carries promptId, baseRevision, add and remove UUID arrays (each at most 20, unique and disjoint). These are membership deltas, never replacement sets. Each reference must belong to the library. An add with a baseline older than the retained removal revision is ignored with a replayable organizationNotice; a deliberate add at or after that revision succeeds. Removals are retained even for absent memberships and survive process restarts. A resulting prompt cannot exceed 20 tags; refusal rolls back every effect. Actual membership changes advance prompt revision/date; tag rename does not. GET prompt returns libraryRevision from the same read transaction as tagIds, so deliberate re-adds can acknowledge no-op removals without depending on modification dates. Create/duplicate may include desired.tagIds; these are submitted snapshots, and omitted tags mean an empty snapshot. Duplication never rereads source memberships. Conflict copies preserve valid tags. Supports prompt.create, prompt.update, prompt.duplicate, prompt.delete, collection.create and collection.rename. Collection operations carry collectionId and name (rather than promptId/desired), and return collectionId in accepted receipts. Names trim outer Unicode White_Space, reject blanks, NUL and malformed scalars, preserve accents/internal spacing, and allow 60 code points. Unicode 17 canonical NFC/full default casefold/NFC keys enforce library-owned uniqueness; collisions return name_conflict with a name field error; capitalization-only rename retains identity. At most 200 collections and 100 MiB shared text including collection names; refusals preserve existing records, correction uses a new operationId. Collection rename advances organization/library revision without changing prompt dates or assignments. Prompt create/duplicate may carry an optional nullable desired.collectionId. Updates may carry nullable collectionId in both base and desired, with exact changedFields, including null to unassign. Omission leaves concurrent assignment intact. Nonexistent/foreign references return validation_failed. Collection assignment competition follows server acceptance order, returning a replayable organizationNotice for superseded choices. Actual assignment changes advance prompt modification date and field revision, unchanged assignments do not. Copies preserve valid collection assignment. Deletion carries only operationId, promptId, baseRevision and dependsOn. It permanently removes active or archived prompts and commits a compact deletion marker, resultant quota counters, changes and receipt atomically. A text-field revision newer than the deletion baseline preserves the current complete variant before removal, including edits later reverted to their old values; metadata-only changes do not require a copy. Text edits after deletion preserve the incoming complete variant without resurrecting the old identity; metadata-only updates return not_found and usage operations remain unsupported. Required preservation failure rolls back every effect and permits an identical retry. Replays after later deletion return original compact receipts without recreating prompts or copies; deleted identities remain unavailable even for identical content. Deleting a conflict copy also removes its associated notice and retained source title, releasing their text quota; deleting an original retains the copies and their notices. There is no trash or restoration of deleted identities. Updates may include typed favorite/archived booleans in both base and desired with exact changedFields. Only changed metadata follows server acceptance order; unchanged values preserve concurrent changes. Archive/favorite mutations retain text and usage; actual changes alone advance prompt dates and field revisions. Duplication carries sourceId, a new promptId and the selected full text snapshot in desired. It never rereads source text: later edits do not alter the copy. The source identity must belong to this library, including retained operation identities. Copies are active, unfavorited, with fresh server dates and no usage. The title gains a Unicode-safe (copy) suffix; the full sourceTitle remains stored, returned in detail and quota-accounted after later copy edits. Updates carry baseRevision, full baseline and desired title/description/content, and exactly the changedFields after normalization. Per-field equal desired text is a no-op; independent edits combine. Competing fields retain accepted text in the original and preserve the full incoming variant in one active, unfavorited conflict copy with fresh dates and no usage. An accepted receipt keeps promptId as the requested original and optionally maps conflict.copyId and conflict.noticeId. Unchanged text leaves prompt modification time unchanged. Never use a replayed receipt to replace newer canonical records or unsaved drafts. Successor drafts follow a returned copy identity using the submitted text and accepted revision as their baseline. Each entry commits independently and returns an accepted receipt or explicit rejection. Titles/descriptions trim Unicode White_Space; title/content are nonblank. Reject unpaired surrogates and NUL. Limits: title 200 code points, description 2,000 code points, content 262,144 UTF-8 bytes. Preserve nonblank content exactly; duplicate titles allowed. Library limits: 10,000 prompts and 104,857,600 stored UTF-8 text bytes including title/description/content. Receipts, notices, copies, changes and counters commit atomically. Quota or storage refusal changes none of these. A separate compact canonical fingerprint survives refused effects so the same identity can retry only the same payload; corrections use a new identity after the earlier outcome is known. Full retained source titles count toward text quota, including when derived titles are shortened to fit 200 Unicode code points. Canonical hashing v1 uses decoded normalized fields and fixed field order (not JSON property order); unchanged UUID/payload replays the original receipt, changed payload returns operation_identity_reused. Freeze transmitted payloads until their outcome is known. API admission is 120 requests/min/account; mutation work admission is 1,200/min and 200/10 seconds. All responses are no-store.",
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
    OrganizationSnapshot: organizationSnapshotSchema,
    OrganizationImpact: organizationImpactSchema,
    OrganizationReview: organizationReviewSchema,
    OrganizationStates: organizationStatesSchema,
    ConflictPage: conflictPageSchema,
    PromptPage: promptPageSchema,
    PromptError: promptErrorSchema,
    MutationEnvelope: mutationEnvelopeSchema,
    MutationResponse: mutationResponseSchema,
  }).map(([name, schema]) => [name, z.toJSONSchema(schema)])
) as Record<string, OpenAPIV3_1.SchemaObject>;
