import "server-only";
import {
  accountErrorSchema,
  accountRequestSchema,
  credentialsSchema,
  emailRequestSchema,
  emptyRequestSchema,
  librarySchema,
  passwordResetSchema,
} from "@pr0/api-contract/accounts";
import type {
  AccountRequest,
  AccountResponse,
} from "@pr0/api-contract/accounts";

import {
  AccountFailureError,
  admit,
  admitEmail,
  assertOrigin,
  assertRegistration,
  clientBucket,
  refundAdmission,
} from "./admission";
import { authentication } from "./auth";
import { configuration } from "./config";
import { database } from "./database";
import { validateMailConfiguration, withMailReservation } from "./mail";
import { resetPassword } from "./recovery";
import { withRequestWork } from "./request-work";
import { withSessionIssuance } from "./session-issuance";

export const json = (
  body: AccountResponse,
  status = 200,
  headers = new Headers()
) => {
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return Response.json(body, { status, headers });
};

export const failure = (error: Error) => {
  if (error instanceof AccountFailureError) {
    const headers = new Headers();
    if (error.retryAfter) {
      headers.set("Retry-After", String(error.retryAfter));
    }
    return json(
      accountErrorSchema.parse({
        code: error.code,
        retryAfter: error.retryAfter,
      }),
      error.status,
      headers
    );
  }
  return json(
    { code: "unavailable", retryAfter: 30 },
    503,
    new Headers({ "Retry-After": "30" })
  );
};

// oxlint-disable eslint/no-await-in-loop -- A bounded request stream must be consumed sequentially and cancelled at its byte limit.
export const readBody = async (request: Request): Promise<AccountRequest> => {
  if (
    request.headers.has("content-encoding") ||
    !request.headers.get("content-type")?.startsWith("application/json")
  ) {
    throw new AccountFailureError("invalid_input", 400);
  }
  const reader = request.body?.getReader();
  if (!reader) {
    throw new AccountFailureError("invalid_input", 400);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, 5000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new AccountFailureError("invalid_input", 413);
      }
      chunks.push(value);
    }
    if (timedOut) {
      throw new AccountFailureError("invalid_input", 400);
    }
  } finally {
    clearTimeout(timer);
  }
  try {
    return accountRequestSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf-8"))
    );
  } catch {
    throw new AccountFailureError("invalid_input", 400);
  }
};
// oxlint-enable eslint/no-await-in-loop

const authRequest = (
  request: Request,
  path: string,
  body?: AccountRequest & { name?: string; callbackURL?: string },
  mailReservation?: string
) => {
  // Discard all forwarding metadata and caller-controlled callbacks/auth fields.
  const headers = new Headers({ Origin: configuration().origin });
  const userAgent = request.headers.get("user-agent");
  if (userAgent) {
    headers.set("user-agent", userAgent.slice(0, 512));
  }
  if (mailReservation) {
    headers.set("x-pr0-mail-reservation", mailReservation);
  }
  const cookie = request.headers.get("cookie");
  if (cookie) {
    headers.set("cookie", cookie);
  }
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return new Request(`${configuration().origin}/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: request.signal,
  });
};

// oxlint-disable react-doctor/server-sequential-independent-await -- Admission must succeed before hashing; refunds require successful authentication.
const handleCredentials = async (
  request: Request,
  path: string,
  body: AccountRequest,
  ip: string
) => {
  const result = credentialsSchema.safeParse(body);
  if (!result.success) {
    throw new AccountFailureError("invalid_input", 400);
  }
  const { email, password } = result.data;
  if (path === "sign-up/email") {
    await admit([{ key: `signup:${ip}`, max: 5, seconds: 3600 }]);
    await assertRegistration(email);
    await admitEmail(email, ip);
    return await withMailReservation(async (reservation) => {
      const response = await authentication().handler(
        authRequest(
          request,
          path,
          {
            email,
            password,
            name: email,
            callbackURL: "/?verified=1",
          },
          reservation
        )
      );
      if (!response.ok) {
        return json({ code: "unavailable", retryAfter: 30 }, 503);
      }
      return json({ status: "verification_required" }, 202);
    });
  }
  // Reserve before hashing to bound concurrent failures; refund successful logins.
  const loginAdmission = await admit([
    { key: `login:pair:${email}:${ip}`, max: 10, seconds: 900 },
    { key: `login:ip:${ip}`, max: 50, seconds: 900 },
  ]);
  const response = await withSessionIssuance(email, () =>
    authentication().handler(authRequest(request, path, { email, password }))
  );
  if (!response.ok) {
    return json({ code: "invalid_credentials" }, 401);
  }
  // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- Only a confirmed successful login may refund its failed-login reservation.
  await refundAdmission(loginAdmission);
  return json({ status: "ok" }, 200, new Headers(response.headers));
};

const processAuth = async (request: Request) => {
  try {
    const path = new URL(request.url).pathname.slice("/api/auth/".length);
    const allowed =
      request.method === "POST"
        ? [
            "sign-up/email",
            "sign-in/email",
            "send-verification-email",
            "sign-out",
            "request-password-reset",
            "reset-password",
          ]
        : ["verify-email"];
    if (!allowed.includes(path)) {
      return json({ code: "not_found" }, 404);
    }
    assertOrigin(request, path === "verify-email");
    const ip = clientBucket(request);
    await admit([
      { key: `auth:minute:${ip}`, max: 60, seconds: 60 },
      { key: `auth:burst:${ip}`, max: 10, seconds: 10 },
    ]);
    if (path === "verify-email") {
      const url = new URL(request.url);
      const token = url.searchParams.get("token");
      if (!token || token.length > 2048) {
        return json({ code: "invalid_verification" }, 400);
      }
      const target = authRequest(
        request,
        `verify-email?token=${encodeURIComponent(token)}`
      );
      const response = await authentication().handler(target);
      return new Response(null, {
        status: 303,
        headers: {
          Location: `${configuration().origin}/?${response.ok ? "verified=1" : "verification=invalid"}`,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    const body = await readBody(request);
    if (path === "reset-password") {
      const input = passwordResetSchema.safeParse(body);
      if (!input.success) {
        throw new AccountFailureError("invalid_input", 400);
      }
      await resetPassword(input.data);
      return json({ status: "ok" });
    }
    if (path === "request-password-reset") {
      const input = emailRequestSchema.safeParse(body);
      if (!input.success) {
        throw new AccountFailureError("invalid_input", 400);
      }
      await admitEmail(input.data.email, ip);
      return await withMailReservation(async (reservation) => {
        const response = await authentication().handler(
          authRequest(request, path, input.data, reservation)
        );
        if (!response.ok) {
          throw new AccountFailureError("unavailable", 503, 30);
        }
        return json({ status: "recovery_requested" }, 202);
      });
    }
    if (path === "sign-up/email" || path === "sign-in/email") {
      return await handleCredentials(request, path, body, ip);
    }
    if (path === "send-verification-email") {
      const input = emailRequestSchema.safeParse(body);
      if (!input.success) {
        throw new AccountFailureError("invalid_input", 400);
      }
      await admitEmail(input.data.email, ip);
      return await withMailReservation(async (reservation) => {
        const response = await authentication().handler(
          authRequest(
            request,
            path,
            {
              email: input.data.email,
              callbackURL: "/?verified=1",
            },
            reservation
          )
        );
        if (!response.ok) {
          return json({ code: "unavailable", retryAfter: 30 }, 503);
        }
        return json({ status: "verification_required" }, 202);
      });
    }
    if (!emptyRequestSchema.safeParse(body).success) {
      throw new AccountFailureError("invalid_input", 400);
    }
    const response = await authentication().handler(
      authRequest(request, "sign-out", {})
    );
    if (!response.ok) {
      return json({ code: "unavailable", retryAfter: 30 }, 503);
    }
    return json({ status: "ok" }, 200, new Headers(response.headers));
  } catch (error) {
    return failure(
      error instanceof Error ? error : new Error("Request failed")
    );
  }
};

export const handleLibrary = async (request: Request) => {
  try {
    assertOrigin(request);
    return await withRequestWork(async (claimOwner) => {
      const result = await authentication().api.getSession({
        headers: authRequest(request, "get-session").headers,
        returnHeaders: true,
      });
      if (!result.response) {
        return json({ code: "unauthenticated" }, 401, result.headers);
      }
      const { session, user } = result.response;
      if (!user.emailVerified) {
        return json({ code: "email_unverified" }, 403, result.headers);
      }
      if (session.provenance !== "browser") {
        return json({ code: "forbidden" }, 403, result.headers);
      }
      const url = new URL(request.url);
      const requestedAccount = url.searchParams.get("accountId");
      if (
        (requestedAccount && requestedAccount !== user.id) ||
        [...url.searchParams.keys()].some((key) => key !== "accountId")
      ) {
        return json({ code: "forbidden" }, 403, result.headers);
      }
      await claimOwner(user.id);
      await admit([{ key: `api:${user.id}`, max: 120, seconds: 60 }]);
      const sql = database();
      const rows =
        await sql`SELECT instance_id, revision::text FROM library WHERE account_id = ${user.id}`;
      if (!rows.length) {
        throw new AccountFailureError("unavailable", 503, 30);
      }
      return json(
        librarySchema.parse({
          instance: { id: rows[0].instance_id, origin: configuration().origin },
          account: { id: user.id, email: user.email, verified: true },
          session: {
            id: session.id,
            expiresAt: session.expiresAt.toISOString(),
            provenance: "browser",
          },
          revision: rows[0].revision,
          prompts: [],
        }),
        200,
        result.headers
      );
    });
  } catch (error) {
    return failure(
      error instanceof Error ? error : new Error("Request failed")
    );
  }
};

export const handleReadiness = async () => {
  try {
    configuration();
    validateMailConfiguration();
    const sql = database();
    const ready =
      await sql`SELECT i.id FROM instance i WHERE schema_version = 4 AND EXISTS
      (SELECT 1 FROM worker_health WHERE name = 'mail' AND heartbeat_at > now() - interval '30 seconds')`;
    return json(
      { status: ready.length ? "ready" : "unavailable" },
      ready.length ? 200 : 503
    );
  } catch {
    return json({ status: "unavailable" }, 503);
  }
};

export const handleAuth = async (request: Request) => {
  try {
    assertOrigin(
      request,
      new URL(request.url).pathname === "/api/auth/verify-email"
    );
    return await withRequestWork(() => processAuth(request));
  } catch (error) {
    return failure(
      error instanceof Error ? error : new Error("Request failed")
    );
  }
};
