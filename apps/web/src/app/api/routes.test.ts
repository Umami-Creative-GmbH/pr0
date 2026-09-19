import { expect, test } from "bun:test";

import { healthResponseSchema } from "@pr0/api-contract/health";

import { GET as getOpenApi } from "./openapi.json/route";
import { GET as getHealth } from "./v1/health/route";

test("health serves an uncached response matching the public contract", async () => {
  const response = getHealth(
    new Request("https://api.example.com/api/v1/health")
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(healthResponseSchema.parse(await response.json())).toEqual({
    status: "ok",
  });
});

test("OpenAPI is public and documents the actual health path", async () => {
  const response = getOpenApi(
    new Request("https://api.example.com/api/openapi.json")
  );
  const document = await response.json();

  expect(response.status).toBe(200);
  expect(document.openapi).toBe("3.1.0");
  expect(document.paths["/api/v1/health"].get.operationId).toBe("getHealth");
  expect(
    document.components.schemas.HealthResponse.properties.status.const
  ).toBe("ok");
});
