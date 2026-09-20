// oxlint-disable eslint/no-await-in-loop -- Public client operations are verified sequentially for attributable failures.
import { expect, mock, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";
import { ZodError } from "zod";

import { ApiError, createApiClient } from "./client";
import type { ApiClient } from "./client";
import { healthQueryOptions } from "./query-options";

test("deletion client validates responses, HTTP failures, invalid handles and cancellation", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  const identity = {
    accountId: "00000000-0000-4000-8000-000000000001",
    emailVersion: 0,
    confirmation: "delete-account" as const,
  };
  const operations = [
    (client: ApiClient) => client.getDeletionTrust(controller.signal),
    (client: ApiClient) => client.getDeletionVerification(controller.signal),
    (client: ApiClient) => client.deleteAccount(identity, controller.signal),
    (client: ApiClient) =>
      client.getDeletionReceipt(
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        controller.signal
      ),
  ];
  const invalid = createApiClient({
    fetcher: () => Promise.resolve(Response.json({})),
  });
  const unavailable = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json({ code: "unavailable", retryAfter: 5 }, { status: 503 })
      ),
  });
  const cancelled = createApiClient({
    fetcher: (_url, init) => Promise.reject(init.signal?.reason),
  });
  for (const operation of operations) {
    await expect(operation(invalid)).rejects.toBeInstanceOf(ZodError);
    await expect(operation(unavailable)).rejects.toMatchObject({
      status: 503,
      code: "unavailable",
      retryAfter: 5,
    });
    await expect(operation(cancelled)).rejects.toBe(controller.signal.reason);
  }
  await expect(
    invalid.getDeletionReceipt("../../account")
  ).rejects.toBeInstanceOf(ZodError);
});

test("login-method client validates responses, typed errors, inputs and cancellation", async () => {
  const identity = {
    accountId: "00000000-0000-4000-8000-000000000001",
    emailVersion: 0,
  };
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  const operations = [
    (client: ApiClient) => client.getLoginMethods(controller.signal),
    (client: ApiClient) =>
      client.linkLoginMethod(
        { ...identity, provider: "google" },
        controller.signal
      ),
    (client: ApiClient) =>
      client.removeLoginMethod(
        { ...identity, methodId: identity.accountId },
        controller.signal
      ),
  ];
  const invalid = createApiClient({
    fetcher: () => Promise.resolve(Response.json({})),
  });
  const denied = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json({ code: "last_login_method" }, { status: 409 })
      ),
  });
  const cancelled = createApiClient({
    fetcher: (_url, init) => Promise.reject(init.signal?.reason),
  });
  for (const operation of operations) {
    await expect(operation(invalid)).rejects.toBeInstanceOf(ZodError);
    await expect(operation(denied)).rejects.toMatchObject({
      status: 409,
      code: "last_login_method",
    });
    await expect(operation(cancelled)).rejects.toBe(controller.signal.reason);
  }
  const fetcher = mock(() => Promise.resolve(Response.json({ status: "ok" })));
  const client = createApiClient({ fetcher });
  await expect(
    client.removeLoginMethod({ ...identity, methodId: "bad" })
  ).rejects.toBeInstanceOf(ZodError);
  await expect(
    client.linkLoginMethod({
      ...identity,
      accountId: "bad",
      provider: "google",
    })
  ).rejects.toBeInstanceOf(ZodError);
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await client.removeLoginMethod({
      ...identity,
      methodId: identity.accountId,
    })
  ).toEqual({ status: "ok" });
});

test("account-change client validates every response, typed failure, input and cancellation", async () => {
  const identity = {
    accountId: "00000000-0000-4000-8000-000000000001",
    emailVersion: 0,
  };
  const verification = {
    ...identity,
    challengeId: "00000000-0000-4000-8000-000000000002",
    code: "01234567",
  };
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  const operations = [
    (client: ApiClient) => client.getAccountSettings(controller.signal),
    (client: ApiClient) =>
      client.requestReauthentication(identity, controller.signal),
    (client: ApiClient) =>
      client.reauthenticate(verification, controller.signal),
    (client: ApiClient) =>
      client.requestEmailChange(
        { ...identity, email: "new@example.test" },
        controller.signal
      ),
    (client: ApiClient) =>
      client.verifyEmailChange(verification, controller.signal),
  ];
  const invalid = createApiClient({
    fetcher: () => Promise.resolve(Response.json({ status: "ok" })),
  });
  const denied = createApiClient({
    fetcher: () =>
      Promise.resolve(
        Response.json({ code: "fresh_auth_required" }, { status: 403 })
      ),
  });
  const cancelled = createApiClient({
    fetcher: (_url, init) => Promise.reject(init.signal?.reason),
  });
  for (const operation of operations) {
    await expect(operation(invalid)).rejects.toBeInstanceOf(ZodError);
    await expect(operation(denied)).rejects.toMatchObject({
      status: 403,
      code: "fresh_auth_required",
    });
    await expect(operation(cancelled)).rejects.toBe(controller.signal.reason);
  }
  const fetcher = mock((_url: string, _init: RequestInit) =>
    Promise.resolve(
      Response.json({ status: "email_changed", notification: "pending" })
    )
  );
  const client = createApiClient({ fetcher });
  await expect(
    client.verifyEmailChange({ ...verification, code: "123" })
  ).rejects.toBeInstanceOf(ZodError);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await client.verifyEmailChange(verification)).toEqual({
    status: "email_changed",
    notification: "pending",
  });
  const [, request] = fetcher.mock.calls[0] ?? [];
  expect(request).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify(verification),
  });
});

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
