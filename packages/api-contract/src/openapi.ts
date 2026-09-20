import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import { accountPaths, accountSchemas } from "./accounts-openapi";
import { deletionPaths, deletionSchemas } from "./deletions-openapi";
import { devicePaths, deviceSchemas } from "./device-openapi";
import { healthPath, healthResponseSchema } from "./health";
import { promptPaths, promptSchemas } from "./prompts-openapi";

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "pr0 API",
    version: "1.0.0",
    description:
      "The public REST interface used by the web and desktop applications.",
  },
  servers: [{ url: "/", description: "Current API host" }],
  tags: [
    { name: "System", description: "Service availability" },
    { name: "Accounts", description: "Verified account access" },
    { name: "Prompts", description: "Owned prompt creation and retrieval" },
  ],
  paths: {
    ...devicePaths,
    ...accountPaths,
    ...deletionPaths,
    ...promptPaths,
    [healthPath]: {
      get: {
        operationId: "getHealth",
        tags: ["System"],
        summary: "Check API availability",
        responses: {
          "200": {
            description:
              "The API is available. This does not check downstream services.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      DesktopSession: {
        type: "http",
        scheme: "bearer",
        description:
          "Independent device-provenance credential. Native HTTPS only.",
      },
      BrowserSession: {
        type: "apiKey",
        in: "cookie",
        name: "__Secure-better-auth.session_token",
        description:
          "Secure HttpOnly cookie. Local HTTP evaluation uses better-auth.session_token.",
      },
    },
    schemas: {
      ...deviceSchemas,
      ...accountSchemas,
      ...deletionSchemas,
      ...promptSchemas,
      // SAFETY: Zod emits valid JSON Schema 2020-12, supported by OpenAPI 3.1 but typed more narrowly by openapi-types.
      HealthResponse: z.toJSONSchema(
        healthResponseSchema
      ) as OpenAPIV3_1.SchemaObject,
    },
  },
} satisfies OpenAPIV3_1.Document;
