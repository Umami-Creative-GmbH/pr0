import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import { deleteAccountSchema } from "./accounts";
import {
  DELETION_VERIFICATION_MAX_PAGE,
  deletionLookupSchema,
  deletionResultSchema,
  deletionTrustSchema,
  deletionVerificationSchema,
  deletionVerificationPageSchema,
} from "./deletions";

const response = (name: string, description: string) => ({
  description,
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
  },
});
const errors = Object.fromEntries(
  [400, 401, 403, 409, 413, 429, 503].map((status) => [
    status,
    response("AccountError", "Request failed; no deletion authority."),
  ])
);
export const deletionPaths = {
  "/api/v1/account/deletion": {
    get: {
      operationId: "getDeletionTrust",
      tags: ["Accounts"],
      security: [{ BrowserSession: [] }],
      description:
        "Authenticated browser setup. Persist the opaque 256-bit handle and anchor separately from session credentials. The handle grants no account access.",
      responses: {
        "200": response(
          "DeletionTrust",
          "Account-bound initial verification material"
        ),
        ...errors,
      },
    },
    post: {
      operationId: "deleteAccount",
      tags: ["Accounts"],
      security: [{ BrowserSession: [] }],
      description:
        "Browser-only, same-origin JSON (4096 bytes maximum), explicit confirmation and authentication completed within ten minutes. Durable barrier, independent intent, live purge, independent signed completion. A pending response is never proof of deletion; recovery continues without a session.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/DeleteAccount" },
          },
        },
      },
      responses: {
        "200": response(
          "DeletionResult",
          "Signed completion durably stored in both independent stores"
        ),
        "202": response(
          "DeletionResult",
          "Deletion pending; poll lookup after retryAfter seconds"
        ),
        ...errors,
      },
    },
  },
  "/api/v1/account-deletions/{handle}": {
    get: {
      operationId: "getDeletionReceipt",
      tags: ["Accounts"],
      security: [],
      description:
        "Minimal unauthenticated no-store lookup. Verify compact JWS Ed25519, typ pr0-account-deletion+jws, pinned key continuity and exact instance/account/handle before cleanup. Unsigned absence has no authority. No expiry or profile data.",
      parameters: [
        {
          name: "handle",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
        },
      ],
      responses: {
        "200": response(
          "DeletionLookup",
          "Signed completion or unsigned absence"
        ),
        ...errors,
      },
    },
  },
  "/api/v1/account-deletions/verification": {
    get: {
      operationId: "getDeletionVerification",
      tags: ["Accounts"],
      security: [],
      description:
        "Retained anchor and signed pr0-deletion-key-rotation+jws statements. Verify every predecessor from the previously pinned anchor; never replace that anchor from this response. Optional zero-based page returns at most 64 rotations and nextPage (null at the end). Pages preserve append order with no total chain lifetime limit. Omit page for the legacy complete-chain response.",
      parameters: [
        {
          name: "page",
          in: "query",
          schema: {
            type: "integer",
            minimum: 0,
            maximum: DELETION_VERIFICATION_MAX_PAGE,
          },
        },
      ],
      responses: {
        "200": {
          description: "Complete or paged public verification material",
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/DeletionVerification" },
                  { $ref: "#/components/schemas/DeletionVerificationPage" },
                ],
              },
            },
          },
        },
        ...errors,
      },
    },
  },
} satisfies OpenAPIV3_1.PathsObject;
export const deletionSchemas = Object.fromEntries(
  Object.entries({
    DeleteAccount: deleteAccountSchema,
    DeletionTrust: deletionTrustSchema,
    DeletionResult: deletionResultSchema,
    DeletionLookup: deletionLookupSchema,
    DeletionVerification: deletionVerificationSchema,
    DeletionVerificationPage: deletionVerificationPageSchema,
  }).map(([name, schema]) => [name, z.toJSONSchema(schema)])
);
