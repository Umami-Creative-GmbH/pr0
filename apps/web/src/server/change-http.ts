// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Recheck committed cursor truth after waiter registration and each bounded wait.
import "server-only";
import { changeRequestSchema } from "@pr0/api-contract/changes";

import { AccountFailureError, admitApi, assertOrigin } from "./admission";
import { authentication } from "./auth";
import type { BrowserAccount } from "./browser-proof";
import { readChanges } from "./change-store";
import { registerChangeWaiter } from "./change-waiters";
import { ensureDeletionRecovery } from "./deletion-recovery";
import { nativeOrigin } from "./device-http";
import { reservePoll } from "./poll-admission";
import { invalidPromptRequest, promptErrorResponse } from "./prompt-errors";
import { withRequestWork } from "./request-work";

const readChangeInput = (request: Request) => {
  const parameters = new URL(request.url).searchParams;
  const fields = Object.fromEntries(parameters);
  const input = changeRequestSchema.safeParse({
    ...fields,
    wait: fields.wait === undefined ? undefined : Number(fields.wait),
  });
  if (
    !input.success ||
    [...parameters.keys()].length !== Object.keys(fields).length
  ) {
    throw invalidPromptRequest();
  }
  return input.data;
};

export const handleChanges = async (request: Request) => {
  try {
    const native = request.headers.has("authorization");
    if (native) {
      nativeOrigin(request);
    } else {
      assertOrigin(request);
    }
    const input = { data: readChangeInput(request) };
    await ensureDeletionRecovery();
    const result = await withRequestWork(() =>
      authentication().api.getSession({
        headers: new Headers(
          native
            ? { authorization: request.headers.get("authorization") ?? "" }
            : { cookie: request.headers.get("cookie") ?? "" }
        ),
        query: { disableCookieCache: true },
        returnHeaders: true,
      })
    );
    if (!result.response) {
      throw new AccountFailureError("unauthenticated", 401);
    }
    const { user, session } = result.response;
    if (
      !user.emailVerified ||
      session.provenance !== (native ? "device" : "browser")
    ) {
      throw new AccountFailureError("forbidden", 403);
    }
    await admitApi(user.id);
    const account: BrowserAccount = {
      accountId: user.id,
      sessionId: session.id,
    };
    if (native) {
      account.provenance = "device";
    }
    const readPage = (pageInput: Parameters<typeof readChanges>[1]) =>
      withRequestWork(async (claimOwner) => {
        await claimOwner(account.accountId);
        return readChanges(account, pageInput);
      }, request.signal);
    let page = await readPage(input.data);
    if (
      !page.changes.length &&
      (input.data.cursor || input.data.after !== undefined) &&
      input.data.wait > 0
    ) {
      const release = await reservePoll(account.accountId);
      let waiter: ReturnType<typeof registerChangeWaiter> | undefined;
      const deadline = Date.now() + input.data.wait * 1000;
      try {
        waiter = registerChangeWaiter(
          `${page.instanceId}:${page.accountId}`,
          request.signal
        );
        while (true) {
          request.signal.throwIfAborted();
          // Registration precedes the second read: a commit in either window is observed.
          page = await readPage({ cursor: page.cursor });
          if (page.changes.length || Date.now() >= deadline) {
            break;
          }
          // Lost notifications and other processes cannot delay visibility past this fallback.
          await waiter.wait(Math.min(1000, deadline - Date.now()));
        }
      } finally {
        waiter?.close();
        await release();
      }
    }
    request.signal.throwIfAborted();
    const headers = new Headers(result.headers);
    headers.set("Cache-Control", "no-store");
    return Response.json(page, { headers });
  } catch (error) {
    return promptErrorResponse(
      error instanceof Error ? error : new Error("Changes unavailable")
    );
  }
};
