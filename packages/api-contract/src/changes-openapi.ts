import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import { changePageSchema } from "./changes";

// SAFETY: Zod emits JSON Schema 2020-12, supported by OpenAPI 3.1.
export const changeSchemas = {
  ChangePage: z.toJSONSchema(changePageSchema) as OpenAPIV3_1.SchemaObject,
};
export const changePaths: OpenAPIV3_1.PathsObject = {
  "/api/v1/sync/changes": {
    get: {
      operationId: "readChanges",
      tags: ["Prompts"],
      security: [{ DesktopSession: [] }, { BrowserSession: [] }],
      description:
        "Verified same-origin browser or native bearer session. One poll per active coordinator, wait 0–25 seconds (default 25). No database transaction or pooled connection is held while waiting. Account-scoped PostgreSQL notifications are hints; registration is followed by a committed cursor recheck and missed notifications are recovered by bounded reads. Omit cursor/after for a current checkpoint (web invalidates its projections before accepting it); a desktop starts with after and epoch from its fully applied snapshot. Subsequent opaque integrity-protected cursors bind account, instance, recovery epoch, schema 1 and pr0-search-v1-ucd17. Events live 90 days and include complete immutable operation effects, full organization state and up to two canonical prompts or a compact organization cleanup event. Apply the complete event, local overlay reconciliation, derived state and cursor atomically. Bulk effects clear/merge all matching assignments and advance affected prompt revision/date using max(acceptedAt, prior modifiedAt + 1 ms). Never replace open drafts or retire later local successors. Replayed pages are safe. Pages have at most 100 events and 4 MiB of serialized JSON. hasMore requires immediate catch-up; freshness advances only after all pages have been applied. Incompatible/expired checkpoints return snapshot_required with retained work. All responses are no-store. Honor Retry-After with bounded jittered backoff.",
      parameters: [
        {
          name: "cursor",
          in: "query",
          schema: { type: "string", maxLength: 2048 },
        },
        {
          name: "after",
          in: "query",
          description: "Snapshot revision; requires epoch and excludes cursor",
          schema: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
        },
        {
          name: "epoch",
          in: "query",
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "wait",
          in: "query",
          schema: { type: "integer", minimum: 0, maximum: 25, default: 25 },
        },
      ],
      responses: {
        "200": {
          description: "Complete bounded page or checkpoint",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ChangePage" },
            },
          },
        },
        "400": {
          description: "Invalid request/cursor or wrong account binding",
        },
        "401": { description: "Sign in to sync; preserve local work" },
        "403": {
          description: "Verified session with matching provenance required",
        },
        "409": {
          description:
            "snapshot_required: recovery handoff; never clear the baseline or pending work",
        },
        "429": { description: "Rate limited; honor Retry-After" },
        "503": { description: "Temporary unavailability; honor Retry-After" },
      },
    },
  },
};
