import { expect, mock, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";
import { ZodError } from "zod";

import { ApiError, createApiClient } from "./client";
import { healthQueryOptions } from "./query-options";

// oxlint-disable eslint/no-await-in-loop -- Sequential contract assertions keep each failure attributable to its public operation.
// oxlint-disable eslint/no-script-url -- A hostile redirect is deliberate negative test input.
test("social client validates redirect destinations, response data, failures, and cancellation", async () => {
  const bad = createApiClient({
    fetcher: () =>
      Promise.resolve(Response.json({ url: "javascript:alert(1)" })),
  });
  await expect(bad.signInSocial("google")).rejects.toBeInstanceOf(ZodError);
  const invalid = createApiClient({
    fetcher: () => Promise.resolve(Response.json({ invalid: true })),
  });
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  const cancelled = createApiClient({
    fetcher: (_url, init) => Promise.reject(init.signal?.reason),
  });
  const failed = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json({ code: "invalid_social" }, { status: 400 })
      ),
  });
  const operations = [
    (client: ReturnType<typeof createApiClient>, signal?: AbortSignal) =>
      client.getSocialProviders(signal),
    (client: ReturnType<typeof createApiClient>, signal?: AbortSignal) =>
      client.signInSocial("github", signal),
    (client: ReturnType<typeof createApiClient>, signal?: AbortSignal) =>
      client.requestSocialEmail("owner@example.test", signal),
    (client: ReturnType<typeof createApiClient>, signal?: AbortSignal) =>
      client.verifySocialEmail("a".repeat(43), signal),
  ];
  for (const operation of operations) {
    await expect(operation(invalid)).rejects.toBeInstanceOf(ZodError);
    await expect(operation(cancelled, controller.signal)).rejects.toMatchObject(
      { name: "AbortError" }
    );
    await expect(operation(failed)).rejects.toMatchObject({
      code: "invalid_social",
      status: 400,
    });
  }
});

// oxlint-enable eslint/no-await-in-loop, eslint/no-script-url

test("account client rejects malformed library data and preserves typed retry guidance", async () => {
  const client = createApiClient({
    fetcher: () => Promise.resolve(Response.json({ prompts: [] })),
  });
  await expect(client.getLibrary()).rejects.toBeInstanceOf(ZodError);
  const limited = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json({ code: "rate_limited", retryAfter: 60 }, { status: 429 })
      ),
  });
  await expect(
    limited.signIn({
      email: "owner@example.test",
      password: "a-long-test-password",
    })
  ).rejects.toMatchObject({
    status: 429,
    code: "rate_limited",
    retryAfter: 60,
  });
});

test("recovery and session client methods validate responses, failures, and cancellation", async () => {
  const id = "626c36c6-7bb6-48d2-a187-9b3c2e349c5b";
  const invalid = createApiClient({
    fetcher: () => Promise.resolve(Response.json({ invalid: true })),
  });
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  const cancelled = createApiClient({
    fetcher: (_url, init) => Promise.reject(init.signal?.reason),
  });
  const failed = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json({ code: "unauthenticated" }, { status: 401 })
      ),
  });
  const operations = [
    (client: ReturnType<typeof createApiClient>, signal?: AbortSignal) =>
      client.requestRecovery("owner@example.test", signal),
    (client: ReturnType<typeof createApiClient>, signal?: AbortSignal) =>
      client.resetPassword(
        { token: "test-token", newPassword: "long-new-password" },
        signal
      ),
    (client: ReturnType<typeof createApiClient>, signal?: AbortSignal) =>
      client.getSessions(signal),
    (client: ReturnType<typeof createApiClient>, signal?: AbortSignal) =>
      client.revokeSession(id, signal),
    (client: ReturnType<typeof createApiClient>, signal?: AbortSignal) =>
      client.revokeOtherSessions(signal),
  ];
  await Promise.all(
    operations.map(async (operation) => {
      await expect(operation(invalid)).rejects.toBeInstanceOf(ZodError);
      await expect(operation(failed)).rejects.toMatchObject({
        status: 401,
        code: "unauthenticated",
      });
      await expect(operation(cancelled, controller.signal)).rejects.toBe(
        controller.signal.reason
      );
    })
  );
});

test("account requests preserve cancellation and typed non-JSON failures", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Account changed", "AbortError");
  controller.abort(reason);
  const fetcher = mock((_url: string, init: RequestInit) =>
    Promise.reject(init.signal?.reason)
  );
  const client = createApiClient({ fetcher });
  await expect(client.getLibrary(controller.signal)).rejects.toBe(reason);
  await expect(
    client.register(
      { email: "owner@example.test", password: "a-long-test-password" },
      controller.signal
    )
  ).rejects.toBe(reason);
  const failed = createApiClient({
    fetcher: () =>
      Promise.resolve(new Response("<h1>Unavailable</h1>", { status: 503 })),
  });
  await expect(failed.getLibrary()).rejects.toMatchObject({
    name: "ApiError",
    status: 503,
  });
});

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
