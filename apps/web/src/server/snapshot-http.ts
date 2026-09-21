// oxlint-disable react-doctor/server-sequential-independent-await -- Authenticate before account admission and materialization.
import "server-only";
import {
  snapshotPageRequestSchema,
  snapshotCreateRequestSchema,
} from "@pr0/api-contract/snapshots";
import { z } from "zod";

import { failure, readRequestJson } from "./account-http";
import { AccountFailureError, admitApi } from "./admission";
import { authentication } from "./auth";
import { nativeOrigin } from "./device-http";
import { withRequestWork } from "./request-work";
import { readSnapshot } from "./snapshot-store";

export const handleSnapshot = async (request: Request, page: boolean) => {
  try {
    nativeOrigin(request);
    const token = request.headers.get("authorization");
    if (!token || !/^Bearer [A-Za-z0-9._~-]{1,512}$/u.test(token)) {
      throw new AccountFailureError("unauthenticated", 401);
    }
    if (new URL(request.url).search) {
      throw new AccountFailureError("invalid_input", 400);
    }
    const input = page
      ? await readRequestJson(request, snapshotPageRequestSchema)
      : await readRequestJson(request, snapshotCreateRequestSchema);
    return await withRequestWork(async (claimOwner) => {
      const current = await authentication().api.getSession({
        headers: new Headers({ authorization: token }),
        query: { disableCookieCache: true },
      });
      if (!current) {
        throw new AccountFailureError("unauthenticated", 401);
      }
      if (
        !current.user.emailVerified ||
        current.session.provenance !== "device"
      ) {
        throw new AccountFailureError("forbidden", 403);
      }
      await claimOwner(current.user.id);
      await admitApi(current.user.id);
      const result = await readSnapshot(
        current.user.id,
        current.session.id,
        input
      );
      return Response.json(
        "expired" in result ? { code: "snapshot_expired" } : result,
        {
          status: "expired" in result ? 410 : 200,
          headers: { "Cache-Control": "no-store" },
        }
      );
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return failure(new AccountFailureError("invalid_input", 400));
    }
    return failure(
      error instanceof Error ? error : new Error("Snapshot unavailable")
    );
  }
};
