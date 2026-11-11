import "server-only";
import { deleteAccountSchema } from "@pr0/api-contract/accounts";
import {
  deletionHandleSchema,
  deletionIdentitySchema,
  deletionLookupSchema,
  deletionResultSchema,
} from "@pr0/api-contract/deletions";

import { failure, readBody } from "./account-http";
import { logAccountDeletion, purgeAccount } from "./account-purge";
import { AccountFailureError, admitApi, assertOrigin } from "./admission";
import { authentication } from "./auth";
import { assertIdentity, lockAccount, requireProof } from "./browser-proof";
import { database } from "./database";
import { withRequestWork } from "./request-work";

const noStore = { "Cache-Control": "no-store" };

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
      await admitApi(browser.accountId);
      if (new URL(request.url).search) {
        throw new AccountFailureError("invalid_input", 400);
      }
      if (request.method === "GET") {
        const identity = await database().begin(async (tx) => {
          const owner = await lockAccount(tx, browser);
          const [library] =
            await tx`SELECT deletion_handle FROM library WHERE account_id=${browser.accountId}`;
          return {
            instanceId: owner.instance_id,
            accountId: browser.accountId,
            handle: library.deletion_handle,
          };
        });
        return Response.json(deletionIdentitySchema.parse(identity), {
          headers: noStore,
        });
      }
      const input = deleteAccountSchema.safeParse(await readBody(request));
      if (!input.success) {
        throw new AccountFailureError("invalid_input", 400);
      }
      const deletion = await database().begin(async (tx) => {
        const owner = await lockAccount(tx, browser);
        assertIdentity(browser, owner, input.data);
        await requireProof(tx, browser, owner);
        return purgeAccount(tx, browser.accountId);
      });
      logAccountDeletion(deletion);
      return Response.json(
        deletionResultSchema.parse({
          status: "deleted",
          accountId: deletion.accountId,
          deletedAt: deletion.deletedAt,
        }),
        { headers: noStore }
      );
    });
  } catch (error) {
    return failure(
      error instanceof Error ? error : new Error("Deletion failed")
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
    const [tombstone] =
      await database()`SELECT account_id,deleted_at FROM deleted_accounts WHERE handle=${handle}`;
    return Response.json(
      deletionLookupSchema.parse(
        tombstone
          ? {
              status: "deleted",
              accountId: tombstone.account_id,
              deletedAt: new Date(tombstone.deleted_at).toISOString(),
            }
          : { status: "absent" }
      ),
      { headers: { ...noStore, "Referrer-Policy": "no-referrer" } }
    );
  } catch (error) {
    return failure(
      error instanceof Error ? error : new Error("Deletion status unavailable")
    );
  }
};
