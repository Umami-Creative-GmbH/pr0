// oxlint-disable eslint/require-await -- Fetch boundary doubles intentionally return immediate responses as promises.
import { describe, expect, test } from "bun:test";

import fixtures from "../../api-contract/src/compatibility-fixtures.json";
import device from "../../api-contract/src/device-fixtures.json";
import { createApiClient } from "./client";

describe("capability negotiation", () => {
  for (const fixture of fixtures) {
    test(fixture.name, async () => {
      const client = createApiClient({
        fetcher: async () =>
          Response.json({
            ...device.capabilities,
            protocols: fixture.protocols,
            normalization: fixture.normalization,
          }),
      });
      const result = await client.getCompatibility();
      expect(result.compatible).toBe(fixture.compatible);
    });
  }
  test("validates malformed discovery and HTTP failures, and propagates cancellation", async () => {
    const controller = new AbortController();
    const client = createApiClient({
      fetcher: async (_url, init) => {
        expect(init.signal).toBe(controller.signal);
        return Response.json({ ...device.capabilities, protocols: [] });
      },
    });
    await expect(client.getCompatibility(controller.signal)).rejects.toThrow();
    const unavailable = createApiClient({
      fetcher: async () =>
        Response.json({ code: "unavailable" }, { status: 503 }),
    });
    await expect(unavailable.getCompatibility()).rejects.toThrow();
    controller.abort();
    const cancelled = createApiClient({
      fetcher: async (_url, init) => {
        init.signal?.throwIfAborted();
        return Response.json(device.capabilities);
      },
    });
    await expect(
      cancelled.getCompatibility(controller.signal)
    ).rejects.toThrow();
  });
});
