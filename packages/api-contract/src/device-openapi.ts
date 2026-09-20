import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod";

import {
  capabilitiesSchema,
  desktopSessionSchema,
  deviceApprovalSchema,
  deviceCancelSchema,
  deviceClientSchema,
  deviceCodeSchema,
  deviceFailureSchema,
  deviceTokenRequestSchema,
  deviceTokenSchema,
} from "./device";

const schemas = {
  Capabilities: capabilitiesSchema,
  DesktopSession: desktopSessionSchema,
  DeviceApproval: deviceApprovalSchema,
  DeviceCancel: deviceCancelSchema,
  DeviceClient: deviceClientSchema,
  DeviceCode: deviceCodeSchema,
  DeviceFailure: deviceFailureSchema,
  DeviceTokenRequest: deviceTokenRequestSchema,
  DeviceToken: deviceTokenSchema,
  DeviceSuccess: z.strictObject({ success: z.literal(true) }),
};
// SAFETY: Zod emits JSON Schema 2020-12, supported by OpenAPI 3.1.
export const deviceSchemas = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema),
  ])
) as Record<string, OpenAPIV3_1.SchemaObject>;
const content = (name: string) => ({
  "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
});
const operation = (
  operationId: string,
  output: string,
  input?: string,
  security: OpenAPIV3_1.SecurityRequirementObject[] = []
) => {
  const result = {
    requestBody: input
      ? { required: true, content: content(input) }
      : undefined,
    operationId,
    tags: ["Accounts"],
    security,
    description:
      "Bounded JSON, no redirects, no-store. Browser approval requires the canonical Origin and a verified browser-provenance session. Native endpoints reject cookies and browser Fetch Metadata. Tokens are for the native process only. Device redemption is at most once: a lost response requires new approval; orphan sessions remain revocable.",
    responses: {
      "200": { description: "Success", content: content(output) },
      "400": {
        description: "Invalid input or device state",
        content: {
          "application/json": {
            schema: {
              oneOf: [
                { $ref: "#/components/schemas/DeviceFailure" },
                { $ref: "#/components/schemas/AccountError" },
              ],
            },
          },
        },
      },
      ...Object.fromEntries(
        [401, 403, 404, 409, 413, 429, 503].map((status) => [
          String(status),
          {
            description:
              "Request rejected. Retry-After is provided for admission limits.",
            content: content("AccountError"),
          },
        ])
      ),
    },
  };
  return result;
};
export const devicePaths = {
  "/api/v1/capabilities": { get: operation("getCapabilities", "Capabilities") },
  "/api/auth/device/code": {
    post: operation("startDeviceApproval", "DeviceCode", "DeviceClient"),
  },
  "/api/auth/device/token": {
    post: operation(
      "redeemDeviceApproval",
      "DeviceToken",
      "DeviceTokenRequest"
    ),
  },
  "/api/auth/device/cancel": {
    post: operation("cancelDeviceApproval", "DeviceSuccess", "DeviceCancel"),
  },
  "/api/auth/device/approve": {
    post: operation("approveDevice", "DeviceSuccess", "DeviceApproval", [
      { BrowserSession: [] },
    ]),
  },
  "/api/auth/device/deny": {
    post: operation("denyDevice", "DeviceSuccess", "DeviceApproval", [
      { BrowserSession: [] },
    ]),
  },
  "/api/v1/desktop/session": {
    get: operation("getDesktopSession", "DesktopSession", undefined, [
      { DesktopSession: [] },
    ]),
  },
  "/api/v1/desktop/sign-out": {
    post: operation("signOutDesktop", "DeviceSuccess", "EmptyRequest", [
      { DesktopSession: [] },
    ]),
  },
} satisfies OpenAPIV3_1.PathsObject;
