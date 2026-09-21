import "server-only";
import { deleteAccountSchema } from "@pr0/api-contract/accounts";
import {
  DELETION_VERIFICATION_PAGE_SIZE,
  DELETION_VERIFICATION_MAX_PAGE,
  deletionHandleSchema,
  deletionTrustSchema,
  deletionVerificationSchema,
  deletionVerificationPageSchema,
} from "@pr0/api-contract/deletions";

import { failure, readBody } from "./account-http";
import { AccountFailureError, assertOrigin } from "./admission";
import { authentication } from "./auth";
import { assertIdentity, lockAccount, requireProof } from "./browser-proof";
import { database } from "./database";
import {
  completeDeletion,
  deletionInstance,
  pendingClaims,
} from "./deletion-coordinator";
import { readEvidence } from "./deletion-ledger";
import { signingKeys } from "./deletion-signing";
import { withRequestWork } from "./request-work";

export const handleAccountDeletion = async (request: Request) => {
  try {
    assertOrigin(request);
    return await withRequestWork(async (claimOwner) => {
      const result = await authentication().api.getSession({
        headers: new Headers({ cookie: request.headers.get("cookie") ?? "" }),
        query: { disableCookieCache: true },
      });
      if (!result) {
        throw new AccountFailureError("unauthenticated", 401);
      }
      if (
        !result.user.emailVerified ||
        result.session.provenance !== "browser" ||
        request.headers.has("authorization")
      ) {
        throw new AccountFailureError("forbidden", 403);
      }
      const browser = {
        accountId: result.user.id,
        sessionId: result.session.id,
      };
      await claimOwner(browser.accountId);
      if (new URL(request.url).search) {
        throw new AccountFailureError("invalid_input", 400);
      }
      if (request.method === "GET") {
        const trust = await database().begin(async (tx) => {
          const owner = await lockAccount(tx, browser);
          const [library] =
            await tx`SELECT deletion_handle FROM library WHERE account_id=${browser.accountId}`;
          return {
            instanceId: owner.instance_id,
            accountId: browser.accountId,
            handle: library.deletion_handle,
          };
        });
        const keys = await signingKeys(trust.instanceId);
        return Response.json(
          deletionTrustSchema.parse({
            ...trust,
            anchor: keys.anchor,
            rotations: keys.rotations,
          }),
          { headers: { "Cache-Control": "no-store" } }
        );
      }
      const input = deleteAccountSchema.safeParse(await readBody(request));
      if (!input.success) {
        throw new AccountFailureError("invalid_input", 400);
      }
      const claims = await database().begin(async (tx) => {
        const owner = await lockAccount(tx, browser);
        assertIdentity(browser, owner, input.data);
        await requireProof(tx, browser, owner);
        const [library] =
          await tx`SELECT deletion_handle FROM library WHERE account_id=${browser.accountId} FOR UPDATE`;
        await tx`UPDATE "user" SET deletion_pending=true WHERE id=${browser.accountId}`;
        const [pending] =
          await tx`INSERT INTO account_deletion_pending(account_id,instance_id,handle,deletion_id,deleted_at)
          VALUES (${browser.accountId},${owner.instance_id},${library.deletion_handle},${crypto.randomUUID()},clock_timestamp())
          ON CONFLICT(account_id) DO UPDATE SET account_id=EXCLUDED.account_id RETURNING *`;
        return pendingClaims(pending);
      });
      try {
        return Response.json(await completeDeletion(claims), {
          headers: { "Cache-Control": "no-store" },
        });
      } catch {
        return Response.json(
          { status: "pending", handle: claims.handle, retryAfter: 5 },
          {
            status: 202,
            headers: { "Cache-Control": "no-store", "Retry-After": "5" },
          }
        );
      }
    });
  } catch (error) {
    return failure(
      error instanceof Error ? error : new Error("Deletion failed")
    );
  }
};

export const handleDeletionVerification = async (request: Request) => {
  try {
    const query = new URL(request.url).searchParams;
    const rawPage = query.get("page");
    const page = rawPage === null ? null : Number(rawPage);
    if (
      [...query.keys()].some((key) => key !== "page") ||
      query.getAll("page").length > 1 ||
      (page !== null &&
        (!rawPage ||
          !Number.isSafeInteger(page) ||
          page < 0 ||
          page > DELETION_VERIFICATION_MAX_PAGE))
    ) {
      throw new AccountFailureError("invalid_input", 400);
    }
    const instanceId = await deletionInstance();
    const keys = await signingKeys(instanceId);
    const material = {
      instanceId,
      anchor: keys.anchor,
      rotations: keys.rotations,
    };
    if (page !== null) {
      const start = page * DELETION_VERIFICATION_PAGE_SIZE;
      if (start > keys.rotations.length) {
        throw new AccountFailureError("invalid_input", 400);
      }
      const end = Math.min(
        start + DELETION_VERIFICATION_PAGE_SIZE,
        keys.rotations.length
      );
      return Response.json(
        deletionVerificationPageSchema.parse({
          ...material,
          rotations: keys.rotations.slice(start, end),
          nextPage: end < keys.rotations.length ? page + 1 : null,
        }),
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    return Response.json(deletionVerificationSchema.parse(material), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(
      error instanceof Error ? error : new Error("Verification unavailable")
    );
  }
};

export const handleDeletionLookup = async (
  request: Request,
  handle: string
) => {
  try {
    if (
      !deletionHandleSchema.safeParse(handle).success ||
      new URL(request.url).search
    ) {
      throw new AccountFailureError("invalid_input", 400);
    }
    const receipt = await readEvidence(
      await deletionInstance(),
      `receipt:${handle}`
    );
    return Response.json(
      receipt ? { status: "deleted", receipt } : { status: "absent" },
      {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      }
    );
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error("Deletion evidence unavailable")
    );
  }
};
