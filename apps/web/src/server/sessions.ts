import "server-only";
import {
  emptyRequestSchema,
  revokeSessionSchema,
  sessionsSchema,
} from "@pr0/api-contract/accounts";

import { failure, json, readBody } from "./account-http";
import { AccountFailureError, admitApi, assertOrigin } from "./admission";
import { authentication } from "./auth";
import { database } from "./database";
import { withRequestWork } from "./request-work";

interface SessionRow {
  id: string;
  provenance: string;
  user_agent: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}

export const handleSessions = async (request: Request) => {
  try {
    assertOrigin(request);
    return await withRequestWork(async (claimOwner) => {
      const result = await authentication().api.getSession({
        headers: new Headers({ cookie: request.headers.get("cookie") ?? "" }),
        query: { disableCookieCache: true },
        returnHeaders: true,
      });
      if (!result.response) {
        return json({ code: "unauthenticated" }, 401, result.headers);
      }
      const { user, session } = result.response;
      if (!user.emailVerified || session.provenance !== "browser") {
        return json({ code: "forbidden" }, 403, result.headers);
      }
      await claimOwner(user.id);
      await admitApi(user.id);
      const sql = database();
      if (request.method === "GET") {
        const rows = await sql<
          SessionRow[]
        >`SELECT id, provenance, user_agent, created_at, updated_at, expires_at
          FROM session WHERE user_id = ${user.id} AND expires_at > clock_timestamp()
          ORDER BY created_at DESC, id`;
        return json(
          sessionsSchema.parse({
            sessions: rows.map((row) => ({
              id: row.id,
              current: row.id === session.id,
              provenance: row.provenance,
              userAgent: row.user_agent,
              createdAt: row.created_at.toISOString(),
              lastActiveAt: row.updated_at.toISOString(),
              expiresAt: row.expires_at.toISOString(),
            })),
          }),
          200,
          result.headers
        );
      }
      const body = await readBody(request);
      const others =
        new URL(request.url).pathname === "/api/v1/sessions/revoke-others";
      const input = others
        ? emptyRequestSchema.safeParse(body)
        : revokeSessionSchema.safeParse(body);
      if (!input.success) {
        throw new AccountFailureError("invalid_input", 400);
      }
      const target =
        "sessionId" in input.data ? input.data.sessionId : undefined;
      await sql.begin(async (tx) => {
        // Serialize account session changes, then revalidate the initiating session.
        await tx`SELECT id FROM "user" WHERE id = ${user.id} FOR UPDATE`;
        const active = await tx`SELECT id FROM session WHERE id = ${session.id}
          AND user_id = ${user.id} AND expires_at > clock_timestamp() FOR UPDATE`;
        if (!active.length) {
          throw new AccountFailureError("unauthenticated", 401);
        }
        if (others) {
          await tx`DELETE FROM session WHERE user_id = ${user.id} AND id <> ${session.id}`;
        } else {
          const removed =
            await tx`DELETE FROM session WHERE user_id = ${user.id} AND id = ${target} RETURNING id`;
          if (!removed.length) {
            throw new AccountFailureError("not_found", 404);
          }
        }
      });
      return json({ status: "ok" }, 200, result.headers);
    });
  } catch (error) {
    return failure(
      error instanceof Error ? error : new Error("Session request failed")
    );
  }
};
