// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Stream consumption and ordered operations must be sequential; each operation owns a short transaction.
import "server-only";
import {
  mutationEnvelopeSchema,
  mutationResponseSchema,
  receiptLookupResponseSchema,
  promptIdentitySchema,
  promptListInputSchema,
  promptBrowseInputSchema,
} from "@pr0/api-contract/prompts";
import type { MutationResult } from "@pr0/api-contract/prompts";

import {
  AccountFailureError,
  admit,
  admitApi,
  assertOrigin,
} from "./admission";
import { authentication } from "./auth";
import type { BrowserAccount } from "./browser-proof";
import { nativeOrigin } from "./device-http";
import { recordFailure } from "./operational-events";
import {
  getOrganizationImpact,
  getOrganizationReview,
  getOrganizationStates,
} from "./organization-read";
import {
  invalidPromptRequest,
  PromptFailureError,
  promptErrorResponse,
  promptFailure,
} from "./prompt-errors";
import {
  mutatePrompt,
  lookupPromptReceipt,
  getOrganization,
  getPrompt,
  listConflicts,
} from "./prompt-store";
import { withRequestWork } from "./request-work";
import { searchPrompts } from "./search-service";
import { serviceLimit } from "./service-limits";

const parseFavorite = (value: string | undefined) => {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return value;
};
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
const mutate = async (
  request: Request,
  browser: BrowserAccount,
  lookup = false
) => {
  const envelope = await readMutation(request);
  const results: (
    | MutationResult
    | { status: "unknown"; operationId: string }
  )[] = [];
  for (const operation of envelope.operations) {
    try {
      await admit([
        {
          key: `mutation:minute:${browser.accountId}`,
          max: serviceLimit("MUTATION_MINUTE", 1200),
          seconds: 60,
        },
        {
          key: `mutation:burst:${browser.accountId}`,
          max: serviceLimit("MUTATION_BURST", 200),
          seconds: 10,
        },
      ]);
      results.push(
        await (lookup
          ? lookupPromptReceipt(browser, envelope, operation)
          : mutatePrompt(browser, envelope, operation))
      );
    } catch (error) {
      recordFailure(
        "mutation",
        promptFailure(
          error instanceof Error ? error : new Error("Mutation failed")
        ).detail.code
      );
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
  return (lookup ? receiptLookupResponseSchema : mutationResponseSchema).parse({
    results,
  });
};
type LibraryRequestTarget =
  | {
      kind: "prompts" | "conflicts" | "organization" | "mutations" | "receipts";
    }
  | { kind: "prompt" | "organization-review"; id: string }
  | { kind: "organization-impact" | "organization-states" };
const readListInput = (url: URL, kind: "conflicts" | "prompts") => {
  try {
    decodeURIComponent(url.search.replaceAll("+", " "));
  } catch {
    throw invalidPromptRequest();
  }
  const entries = Object.fromEntries(url.searchParams);
  const fields = {
    ...entries,
    limit: entries.limit === undefined ? undefined : Number(entries.limit),
  };
  const input =
    kind === "conflicts"
      ? promptListInputSchema.safeParse(fields)
      : promptBrowseInputSchema.safeParse({
          ...fields,
          tagIds: entries.tagIds?.split(","),
          favorite: parseFavorite(entries.favorite),
        });
  if (
    !input.success ||
    [...url.searchParams.keys()].length !== Object.keys(entries).length
  ) {
    throw invalidPromptRequest();
  }

  return input;
};
const promptIdRequestValid = (url: URL, id: string) =>
  !url.search && promptIdentitySchema.safeParse(id).success;
const sessionHeaders = (request: Request, native: boolean) =>
  new Headers(
    native
      ? { authorization: request.headers.get("authorization") ?? "" }
      : { cookie: request.headers.get("cookie") ?? "" }
  );
export const handlePrompts = async (
  request: Request,
  target: LibraryRequestTarget
) => {
  try {
    const native =
      request.headers.has("authorization") &&
      (target.kind === "mutations" ||
        target.kind === "receipts" ||
        target.kind === "organization-states");
    if (native) {
      nativeOrigin(request);
    } else {
      assertOrigin(request);
    }
    return await withRequestWork(async (claimOwner) => {
      const result = await authentication().api.getSession({
        headers: sessionHeaders(request, native),
        query: { disableCookieCache: true },
        returnHeaders: true,
      });
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
      await claimOwner(user.id);
      await admitApi(user.id);
      const browser: BrowserAccount = {
        accountId: user.id,
        sessionId: session.id,
      };
      if (native) {
        browser.provenance = "device";
      }
      const url = new URL(request.url);
      let body;
      let searchTiming: string | undefined;
      if (target.kind === "mutations" || target.kind === "receipts") {
        if (url.search) {
          throw invalidPromptRequest();
        }
        body = await mutate(request, browser, target.kind === "receipts");
      } else if (target.kind === "organization-impact") {
        body = await getOrganizationImpact(browser, url);
      } else if (target.kind === "organization-review") {
        body = await getOrganizationReview(browser, target.id, url);
      } else if (target.kind === "organization-states") {
        body = await getOrganizationStates(browser, url);
      } else if (target.kind === "organization") {
        if (url.search) {
          throw invalidPromptRequest();
        }
        body = await getOrganization(browser);
      } else if (target.kind === "prompt") {
        if (!promptIdRequestValid(url, target.id)) {
          throw invalidPromptRequest();
        }
        body = await getPrompt(browser, target.id);
      } else {
        const input = readListInput(url, target.kind);
        if (target.kind === "conflicts") {
          body = await listConflicts(
            browser,
            input.data.limit,
            input.data.cursor
          );
        } else {
          const search = await searchPrompts(
            browser,
            promptBrowseInputSchema.parse(input.data),
            request.signal
          );
          body = search.page;
          searchTiming = search.timing;
        }
      }
      const headers = new Headers(result.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("Referrer-Policy", "no-referrer");
      if (searchTiming) {
        headers.set("Server-Timing", searchTiming);
      }
      return Response.json(body, { headers });
    }, request.signal);
  } catch (error) {
    return promptErrorResponse(
      error instanceof Error ? error : new Error("Prompt request failed")
    );
  }
};
