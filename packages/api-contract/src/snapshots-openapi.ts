import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import {
  snapshotManifestSchema,
  snapshotPageRequestSchema,
  snapshotPageSchema,
  snapshotRecordsSchema,
} from "./snapshots";

const schemas = {
  SnapshotManifest: snapshotManifestSchema,
  SnapshotPageRequest: snapshotPageRequestSchema,
  SnapshotPage: snapshotPageSchema,
  SnapshotRecords: snapshotRecordsSchema,
};
// SAFETY: Zod emits JSON Schema 2020-12, supported by OpenAPI 3.1.
export const snapshotSchemas = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema),
  ])
) as Record<string, OpenAPIV3_1.SchemaObject>;
const content = (name: string) => ({
  "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
});
const operation = (page: boolean) => ({
  operationId: page ? "readSnapshotPage" : "createSnapshot",
  tags: ["Prompts"],
  security: [{ DesktopSession: [] }],
  description:
    "Device bearer only; cookies and browser Fetch Metadata are rejected. A materialized account/instance/epoch/revision cut is reusable for 15 minutes. No transaction spans requests. Maximum serialized page response: 4 MiB UTF-8; manifest: 256 KiB. SHA-256 digests cover the exact UTF-8 bytes of the decoded payload string (SnapshotRecords JSON), with no reserialization. Apply pages in order and advance progress only after local commit. A completed snapshot is complete at its cut, not a claim of current synchronization. Expiry requires a new manifest while retaining usable local data.",
  requestBody: {
    required: true,
    content: page
      ? content("SnapshotPageRequest")
      : {
          "application/json": {
            schema: { type: "object" as const, additionalProperties: false },
          },
        },
  },
  responses: {
    "200": {
      description: "Account-isolated snapshot",
      content: content(page ? "SnapshotPage" : "SnapshotManifest"),
    },
    "400": { description: "Malformed or out-of-bounds request" },
    "401": { description: "Sign in again; preserve local data" },
    "403": { description: "Native device session required" },
    "404": { description: "Snapshot/page absent or not owned by caller" },
    "410": {
      description:
        "Snapshot expired or recovery epoch changed; restart without wiping local data",
      content: {
        "application/json": {
          schema: {
            type: "object" as const,
            properties: { code: { enum: ["snapshot_expired"] } },
            required: ["code"],
            additionalProperties: false,
          },
        },
      },
    },
    "429": { description: "Retry after the Retry-After delay" },
    "503": {
      description: "Temporary server/storage failure; retain local data",
    },
  },
});
export const snapshotPaths = {
  "/api/v1/sync/snapshots": { post: operation(false) },
  "/api/v1/sync/snapshots/page": { post: operation(true) },
};
