import { expect, mock, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";
import { ZodError } from "zod";

import { ApiError, createApiClient } from "./client";
import { healthQueryOptions } from "./query-options";

test("uses the same-origin API and validates its response", async () => {
  const fetcher = mock(() => Promise.resolve(Response.json({ status: "ok" })));
  const client = createApiClient({ fetcher });

  expect(await client.getHealth()).toEqual({ status: "ok" });
  expect(fetcher).toHaveBeenCalledWith("/api/v1/health", {
    headers: { Accept: "application/json" },
    signal: undefined,
  });
});

test("normalizes a desktop API URL and forwards cancellation", async () => {
  const fetcher = mock(() => Promise.resolve(Response.json({ status: "ok" })));
  const controller = new AbortController();
  const client = createApiClient({
    baseUrl: "https://api.example.com///",
    fetcher,
  });

  await client.getHealth(controller.signal);

  expect(fetcher).toHaveBeenCalledWith(
    "https://api.example.com/api/v1/health",
    {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }
  );
});

test("HTTP failures remain typed even when the server returns HTML", async () => {
  const client = createApiClient({
    fetcher: () =>
      Promise.resolve(new Response("<h1>Bad gateway</h1>", { status: 502 })),
  });

  await expect(client.getHealth()).rejects.toMatchObject({
    name: "ApiError",
    status: 502,
  });
});

test("rejects successful responses that violate the shared contract", async () => {
  const client = createApiClient({
    fetcher: () => Promise.resolve(Response.json({ status: "unexpected" })),
  });

  await expect(client.getHealth()).rejects.toBeInstanceOf(ZodError);
});

test("propagates cancellation without converting it to an HTTP error", async () => {
  const reason = new DOMException("Cancelled", "AbortError");
  const client = createApiClient({ fetcher: () => Promise.reject(reason) });

  await expect(client.getHealth()).rejects.toBe(reason);
});

test("does not retry a client HTTP error", async () => {
  const fetcher = mock(() =>
    Promise.resolve(new Response(null, { status: 401 }))
  );
  const client = createApiClient({ fetcher });
  const queryClient = new QueryClient();

  await expect(
    queryClient.fetchQuery(healthQueryOptions(client))
  ).rejects.toBeInstanceOf(ApiError);
  expect(fetcher).toHaveBeenCalledTimes(1);
  queryClient.clear();
});

test("isolates cached responses by API origin", async () => {
  const fetcher = mock(() => Promise.resolve(Response.json({ status: "ok" })));
  const first = createApiClient({
    baseUrl: "https://first.example.com",
    fetcher,
  });
  const second = createApiClient({
    baseUrl: "https://second.example.com",
    fetcher,
  });
  const queryClient = new QueryClient();

  await queryClient.fetchQuery(healthQueryOptions(first));
  await queryClient.fetchQuery(healthQueryOptions(first));
  await queryClient.fetchQuery(healthQueryOptions(second));

  expect(fetcher).toHaveBeenCalledTimes(2);
  queryClient.clear();
});
