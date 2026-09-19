import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import { healthPath, healthResponseSchema } from "./health";

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "pr0 API",
    version: "1.0.0",
    description:
      "The public REST interface used by the web and desktop applications.",
  },
  servers: [{ url: "/", description: "Current API host" }],
  tags: [{ name: "System", description: "Service availability" }],
  paths: {
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
    schemas: {
      // SAFETY: Zod emits valid JSON Schema 2020-12, supported by OpenAPI 3.1 but typed more narrowly by openapi-types.
      HealthResponse: z.toJSONSchema(
        healthResponseSchema
      ) as OpenAPIV3_1.SchemaObject,
    },
  },
} satisfies OpenAPIV3_1.Document;
