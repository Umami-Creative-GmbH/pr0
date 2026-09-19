import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import {
  accountErrorSchema,
  credentialsSchema,
  emailRequestSchema,
  librarySchema,
  successSchema,
  verificationRequiredSchema,
} from "./accounts";

const jsonResponse = (schema: string, description: string) => ({
  description,
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
  },
});
const errors = Object.fromEntries(
  [400, 401, 403, 404, 413, 429, 503].map((status) => [
    String(status),
    {
      ...jsonResponse(
        "AccountError",
        "Validated error; 429/503 include retry guidance when available."
      ),
      headers: {
        "Retry-After": {
          schema: { type: "integer" as const },
          description: "Seconds before retry",
        },
      },
    },
  ])
);
const post = (
  operationId: string,
  schema: string,
  response: string,
  status = "200"
) => ({
  post: {
    operationId,
    tags: ["Accounts"],
    description:
      "Same-origin browser request. The Origin header must equal the configured canonical origin. JSON body maximum 4096 bytes; no content encoding. Unlisted Better Auth routes are disabled.",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${schema}` },
        },
      },
    },
    responses: {
      [status]: jsonResponse(response, "Request completed"),
      ...errors,
    },
  },
});

export const accountPaths = {
  "/api/auth/sign-up/email": post(
    "registerAccount",
    "Credentials",
    "VerificationRequired",
    "202"
  ),
  "/api/auth/sign-in/email": post(
    "signInAccount",
    "Credentials",
    "AccountSuccess"
  ),
  "/api/auth/send-verification-email": post(
    "resendVerification",
    "EmailRequest",
    "VerificationRequired",
    "202"
  ),
  "/api/auth/sign-out": post(
    "signOutAccount",
    "EmptyRequest",
    "AccountSuccess"
  ),
  "/api/auth/verify-email": {
    get: {
      operationId: "verifyEmail",
      tags: ["Accounts"],
      parameters: [
        {
          in: "query",
          name: "token",
          required: true,
          schema: { type: "string", maxLength: 2048 },
        },
      ],
      description:
        "Email link verification. Redirects to the canonical sign-in screen with a success or invalid-link message; never automatically signs in. Caller callback destinations are ignored.",
      responses: {
        "303": {
          description: "Return to sign-in",
          headers: { Location: { schema: { type: "string" } } },
        },
        ...errors,
      },
    },
  },
  "/api/v1/library": {
    get: {
      operationId: "getPrivateLibrary",
      tags: ["Accounts"],
      security: [{ BrowserSession: [] }],
      description:
        "Verified browser account's library boundary. Renews the persisted session to 30 days from this request and returns its renewed HttpOnly cookie. No prompt operations are exposed in this slice.",
      parameters: [
        {
          in: "query",
          name: "accountId",
          schema: { type: "string", format: "uuid" },
          description:
            "Optional expected account identity; a different identity is forbidden.",
        },
      ],
      responses: {
        "200": jsonResponse(
          "PrivateLibrary",
          "Own empty library, account, instance, and public session metadata"
        ),
        ...errors,
      },
    },
  },
  "/api/v1/ready": {
    get: {
      operationId: "getReadiness",
      tags: ["System"],
      responses: {
        "200": jsonResponse(
          "Readiness",
          "Account schema and recent mail worker heartbeat are available; SMTP acceptance is not inbox delivery."
        ),
        "503": jsonResponse(
          "Readiness",
          "Configuration, schema, database, or worker is unavailable"
        ),
      },
    },
  },
} satisfies OpenAPIV3_1.PathsObject;

const schemas = {
  Credentials: credentialsSchema,
  EmailRequest: emailRequestSchema,
  AccountError: accountErrorSchema,
  VerificationRequired: verificationRequiredSchema,
  AccountSuccess: successSchema,
  PrivateLibrary: librarySchema,
  EmptyRequest: z.strictObject({}),
  Readiness: z.strictObject({ status: z.enum(["ready", "unavailable"]) }),
};
export const accountSchemas = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema),
  ])
);
