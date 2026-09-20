// oxlint-disable react-doctor/server-sequential-independent-await -- Admission and code/account locks must precede authentication state transitions.
import "server-only";
import { emptyRequestSchema } from "@pr0/api-contract/accounts";
import type { AccountRequest } from "@pr0/api-contract/accounts";
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
} from "@pr0/api-contract/device";
import { z } from "zod";

import { failure, readBody } from "./account-http";
import {
  AccountFailureError,
  admit,
  assertOrigin,
  clientBucket,
} from "./admission";
import { authentication } from "./auth";
import { configuration } from "./config";
import { database } from "./database";
import { deletionInstance } from "./deletion-coordinator";
import { signingKeys } from "./deletion-signing";
import { withRequestWork } from "./request-work";
import { withDeviceIssuance } from "./session-issuance";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- HTTP serialization boundary; each successful payload is parsed with its endpoint schema.
const response = (body: unknown, status = 200, headers = new Headers()) => {
  headers.delete("set-auth-token");
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return Response.json(body, { status, headers });
};
export const nativeOrigin = (request: Request) => {
  // Native callers do not have browser cookies or Fetch Metadata. A bearer in a
  // cookie never grants native or browser-only authority.
  if (
    request.headers.has("cookie") ||
    request.headers.has("sec-fetch-site") ||
    (request.headers.has("origin") &&
      request.headers.get("origin") !== configuration().origin)
  ) {
    throw new AccountFailureError("forbidden", 403);
  }
};
const authCall = (
  path: string,
  body?: AccountRequest | { userCode: string },
  cookie?: string
) => {
  const headers = new Headers({ Origin: configuration().origin });
  if (body) {
    headers.set("Content-Type", "application/json");
  }
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  return authentication().handler(
    new Request(`${configuration().origin}/api/auth/${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  );
};
const validatedAuthResponse = async (result: Response, schema: z.ZodType) => {
  const payload: unknown = await result.json();
  return response(
    result.ok ? schema.parse(payload) : deviceFailureSchema.parse(payload),
    result.status
  );
};

const approve = async (request: Request, path: string) => {
  assertOrigin(request);
  const input = deviceApprovalSchema.parse(await readBody(request));
  const cookie = request.headers.get("cookie") ?? "";
  const authenticated = await authentication().api.getSession({
    headers: new Headers({ cookie }),
    returnHeaders: true,
  });
  const browser = authenticated.response;
  if (!browser) {
    throw new AccountFailureError("unauthenticated", 401);
  }
  if (!browser.user.emailVerified || browser.session.provenance !== "browser") {
    throw new AccountFailureError("forbidden", 403);
  }
  if (browser.user.id !== input.accountId) {
    throw new AccountFailureError("account_changed", 409);
  }
  await admit([
    { key: `device-approve:${browser.user.id}`, max: 30, seconds: 60 },
  ]);
  const sql = database();
  return sql.begin(async (tx) => {
    const [code] =
      await tx`SELECT device_code FROM device_code WHERE user_code = ${input.userCode}`;
    if (!code) {
      return response({ error: "invalid_grant" }, 400);
    }
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${code.device_code}, 39))`;
    const [owner] =
      await tx`SELECT authentication_version FROM "user" WHERE id = ${input.accountId} AND email_verified AND NOT deletion_pending FOR SHARE`;
    const active =
      await tx`SELECT id FROM session WHERE id = ${browser.session.id} AND user_id = ${input.accountId}
      AND provenance = 'browser' AND expires_at > clock_timestamp()`;
    if (!owner || !active.length) {
      throw new AccountFailureError("unauthenticated", 401);
    }
    const claim = await authCall(
      `device?user_code=${input.userCode}`,
      undefined,
      cookie
    );
    if (!claim.ok) {
      return validatedAuthResponse(claim, z.unknown());
    }
    const result = await authCall(path, { userCode: input.userCode }, cookie);
    if (result.ok) {
      await tx`UPDATE device_code SET authentication_version = ${owner.authentication_version} WHERE user_code = ${input.userCode}`;
    }
    const output = await validatedAuthResponse(
      result,
      z.object({ success: z.literal(true) })
    );
    for (const value of authenticated.headers.getSetCookie()) {
      output.headers.append("Set-Cookie", value);
    }
    return output;
  });
};

const nativeCode = async (request: Request, path: string) => {
  nativeOrigin(request);
  const body = await readBody(request);
  const sql = database();
  if (path === "device/code") {
    const input = deviceClientSchema.parse(body);
    await admit([
      { key: `device-create:${clientBucket(request)}`, max: 10, seconds: 600 },
    ]);
    await sql`DELETE FROM device_code WHERE expires_at < clock_timestamp() - interval '1 hour'`;
    return validatedAuthResponse(await authCall(path, input), deviceCodeSchema);
  }
  const input =
    path === "device/cancel"
      ? deviceCancelSchema.parse(body)
      : deviceTokenRequestSchema.parse(body);
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${input.device_code}, 39))`;
    if (path === "device/cancel") {
      await tx`DELETE FROM device_code WHERE device_code = ${input.device_code} AND client_id = 'pr0-desktop'`;
      return response({ success: true });
    }
    const [code] =
      await tx`SELECT authentication_version FROM device_code WHERE device_code = ${input.device_code}`;
    return withDeviceIssuance(code?.authentication_version ?? -1, async () =>
      validatedAuthResponse(await authCall(path, input), deviceTokenSchema)
    );
  });
};

export const handleDevice = async (request: Request) => {
  try {
    const path = new URL(request.url).pathname.slice("/api/auth/".length);
    if (
      request.method !== "POST" ||
      ![
        "device/code",
        "device/token",
        "device/cancel",
        "device/approve",
        "device/deny",
      ].includes(path)
    ) {
      throw new AccountFailureError("not_found", 404);
    }
    return await withRequestWork(async () => {
      await admit([
        { key: `device-api:${clientBucket(request)}`, max: 120, seconds: 60 },
      ]);
      return path === "device/approve" || path === "device/deny"
        ? approve(request, path)
        : nativeCode(request, path);
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return failure(new AccountFailureError("invalid_input", 400));
    }
    return failure(
      error instanceof Error ? error : new Error("Device request failed")
    );
  }
};

export const handleCapabilities = async (request: Request) => {
  try {
    return await withRequestWork(async () => {
      await admit([
        { key: `discovery:${clientBucket(request)}`, max: 60, seconds: 60 },
      ]);
      const instanceId = await deletionInstance();
      const keys = await signingKeys(instanceId);
      return response(
        capabilitiesSchema.parse({
          instanceId,
          origin: configuration().origin,
          protocols: [1],
          normalization: "pr0-search-v1-ucd17",
          deviceAuthorization: true,
          deletionKey: keys.anchor,
          limits: { credentialBytes: 2560, responseBytes: 16_384 },
        })
      );
    });
  } catch {
    return failure(new Error("Discovery unavailable"));
  }
};

export const handleDesktopSession = async (request: Request) => {
  try {
    nativeOrigin(request);
    const token = request.headers.get("authorization");
    if (!token || !/^Bearer [A-Za-z0-9._~-]{1,512}$/u.test(token)) {
      throw new AccountFailureError("unauthenticated", 401);
    }
    return await withRequestWork(async (claimOwner) => {
      const current = await authentication().api.getSession({
        headers: new Headers({ authorization: token }),
        returnHeaders: true,
      });
      const result = current.response;
      if (!result) {
        throw new AccountFailureError("unauthenticated", 401);
      }
      if (
        !result.user.emailVerified ||
        result.session.provenance !== "device"
      ) {
        throw new AccountFailureError("forbidden", 403);
      }
      await claimOwner(result.user.id);
      await admit([{ key: `api:${result.user.id}`, max: 120, seconds: 60 }]);
      const sql = database();
      if (request.method === "POST") {
        if (!emptyRequestSchema.safeParse(await readBody(request)).success) {
          throw new AccountFailureError("invalid_input", 400);
        }
        await sql`DELETE FROM session WHERE id = ${result.session.id} AND provenance = 'device'`;
        return response({ success: true });
      }
      const [row] =
        await sql`SELECT i.id, l.deletion_handle FROM instance i CROSS JOIN library l WHERE l.account_id = ${result.user.id}`;
      return response(
        desktopSessionSchema.parse({
          instance: { id: row.id, origin: configuration().origin },
          account: {
            id: result.user.id,
            email: result.user.email,
            verified: true,
          },
          session: {
            id: result.session.id,
            expiresAt: result.session.expiresAt.toISOString(),
            provenance: "device",
          },
          deletionHandle: row.deletion_handle,
        })
      );
    });
  } catch (error) {
    return failure(
      error instanceof Error ? error : new Error("Session unavailable")
    );
  }
};
