import { expect, test } from "bun:test";

import { createApiClient } from "@pr0/api-client/client";
import { capabilitiesSchema } from "@pr0/api-contract/device";

import { origin, ingressHeaders } from "./http-fixture";

test("legacy desktop discovery retains its strict shape and new discovery negotiates protocol 1", async () => {
  const response = await fetch(`${origin}/api/v1/capabilities`, {
    headers: ingressHeaders(),
  });
  expect(response.status).toBe(200);
  const legacy = capabilitiesSchema.parse(await response.json());
  expect(legacy.compatibility).toBeUndefined();
  expect(legacy.protocols).toEqual([1]);
  expect(legacy.normalization).toBe("pr0-search-v1-ucd17");
  const client = createApiClient({ baseUrl: origin });
  const negotiated = await client.getCompatibility();
  expect(negotiated.compatible).toBe(true);
  expect(negotiated.capabilities.compatibility?.supportDays).toBe(90);
  expect(negotiated.contract).toEqual({
    protocol: 1,
    normalization: "pr0-search-v1-ucd17",
  });
});
