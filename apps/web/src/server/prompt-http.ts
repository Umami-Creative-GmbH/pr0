// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Stream consumption and ordered operations must be sequential; each operation owns a short transaction.
import "server-only";
import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  promptIdentitySchema,
  promptListInputSchema,
} from "@pr0/api-contract/prompts";
import type { MutationResult } from "@pr0/api-contract/prompts";

import { AccountFailureError, admit, assertOrigin } from "./admission";
import { authentication } from "./auth";
import type { BrowserAccount } from "./browser-proof";
import {
  invalidPromptRequest,
  PromptFailureError,
  promptErrorResponse,
  promptFailure,
} from "./prompt-errors";
import { createPrompt, getPrompt, listPrompts } from "./prompt-store";
import { withRequestWork } from "./request-work";

const readMutation = async (request: Request) => {
  if (
    request.headers.has("content-encoding") ||
    !request.headers.get("content-type")?.startsWith("application/json")
  ) {
    throw invalidPromptRequest();
  }
  const reader = request.body?.getReader();
  if (!reader) {
    throw invalidPromptRequest();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel();
  }, 5000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > 4_194_304) {
        await reader.cancel();
        throw new PromptFailureError(invalidPromptRequest().detail, 413);
      }
      chunks.push(value);
    }
    if (expired) {
      throw invalidPromptRequest();
    }
    try {
      return mutationEnvelopeSchema.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks)
          )
        )
      );
    } catch {
      throw invalidPromptRequest();
    }
  } finally {
    clearTimeout(timer);
  }
};
const mutate = async (request: Request, browser: BrowserAccount) => {
  const envelope = await readMutation(request);
  const results: MutationResult[] = [];
  for (const operation of envelope.operations) {
    try {
      await admit([
        { key: `mutation:minute:${browser.accountId}`, max: 1200, seconds: 60 },
        { key: `mutation:burst:${browser.accountId}`, max: 200, seconds: 10 },
      ]);
      results.push(await createPrompt(browser, envelope, operation));
    } catch (error) {
      results.push({
        status: "rejected",
        error: {
          ...promptFailure(
            error instanceof Error ? error : new Error("Mutation failed")
          ).detail,
          operationId: operation.operationId,
        },
      });
    }
  }
  return mutationResponseSchema.parse({ results });
};
export const handlePrompts = async (request: Request, promptId?: string) => {
  try {
    assertOrigin(request);
    return await withRequestWork(async (claimOwner) => {
      const result = await authentication().api.getSession({
        headers: new Headers({ cookie: request.headers.get("cookie") ?? "" }),
        query: { disableCookieCache: true },
        returnHeaders: true,
      });
      if (!result.response) {
        throw new AccountFailureError("unauthenticated", 401);
      }
      const { user, session } = result.response;
      if (!user.emailVerified || session.provenance !== "browser") {
        throw new AccountFailureError("forbidden", 403);
      }
      await claimOwner(user.id);
      await admit([{ key: `api:${user.id}`, max: 120, seconds: 60 }]);
      const browser = { accountId: user.id, sessionId: session.id };
      const url = new URL(request.url);
      let body;
      if (request.method === "POST") {
        if (url.search) {
          throw invalidPromptRequest();
        }
        body = await mutate(request, browser);
      } else if (promptId) {
        if (url.search || !promptIdentitySchema.safeParse(promptId).success) {
          throw invalidPromptRequest();
        }
        body = await getPrompt(browser, promptId);
      } else {
        const entries = Object.fromEntries(url.searchParams);
        const input = promptListInputSchema.safeParse({
          ...entries,
          limit:
            entries.limit === undefined ? undefined : Number(entries.limit),
        });
        if (
          !input.success ||
          [...url.searchParams.keys()].length !== Object.keys(entries).length
        ) {
          throw invalidPromptRequest();
        }
        body = await listPrompts(browser, input.data.limit, input.data.cursor);
      }
      const headers = new Headers(result.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("Referrer-Policy", "no-referrer");
      return Response.json(body, { headers });
    });
  } catch (error) {
    return promptErrorResponse(
      error instanceof Error ? error : new Error("Prompt request failed")
    );
  }
};
