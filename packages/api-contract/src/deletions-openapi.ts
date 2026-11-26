import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import { deleteAccountSchema } from "./accounts";
import {
  deletionIdentitySchema,
  deletionLookupSchema,
  deletionResultSchema,
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
    response("AccountError", "Request failed; nothing was deleted."),
  ])
);
export const deletionPaths = {
  "/api/v1/account/deletion": {
    get: {
      operationId: "getDeletionIdentity",
      tags: ["Accounts"],
      security: [{ BrowserSession: [] }],
      description:
        "Authenticated browser setup. Persist the instance, account and opaque 256-bit handle separately from session credentials, so a reload can check the outcome. The handle grants no account access.",
      responses: {
        "200": response(
          "DeletionIdentity",
          "Account-bound identity for the status lookup"
        ),
        ...errors,
      },
    },
    post: {
      operationId: "deleteAccount",
      tags: ["Accounts"],
      security: [{ BrowserSession: [] }],
      description:
        "Browser-only, same-origin JSON (4096 bytes maximum), explicit confirmation and authentication completed within ten minutes. One transaction removes the account and all of its live data and leaves only an opaque tombstone. An error means nothing was deleted; if the response was lost, check the status lookup.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/DeleteAccount" },
          },
        },
      },
      responses: {
        "200": response("DeletionResult", "Account and library deleted"),
        ...errors,
      },
    },
  },
  "/api/v1/account-deletions/{handle}": {
    get: {
      operationId: "getDeletionStatus",
      tags: ["Accounts"],
      security: [],
      description:
        "Minimal unauthenticated no-store lookup of the instance's deletion tombstone. Clean up local data only when status is deleted and accountId matches the signed-in account. Absence never authorizes cleanup: after an operator restores an older backup, a deletion may be absent until the operator re-applies it.",
      parameters: [
        {
          name: "handle",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
        },
      ],
      responses: {
        "200": response("DeletionLookup", "Deleted or absent"),
        ...errors,
      },
    },
  },
} satisfies OpenAPIV3_1.PathsObject;
export const deletionSchemas = Object.fromEntries(
  Object.entries({
    DeleteAccount: deleteAccountSchema,
    DeletionIdentity: deletionIdentitySchema,
    DeletionResult: deletionResultSchema,
    DeletionLookup: deletionLookupSchema,
  }).map(([name, schema]) => [name, z.toJSONSchema(schema)])
);
