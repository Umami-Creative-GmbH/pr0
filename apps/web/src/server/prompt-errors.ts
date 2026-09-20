import "server-only";
import { promptErrorSchema } from "@pr0/api-contract/prompts";
import type { PromptError } from "@pr0/api-contract/prompts";

import { AccountFailureError } from "./admission";

export class PromptFailureError extends Error {
  readonly detail: PromptError;
  readonly status: number;
  constructor(detail: PromptError, status = 422) {
    super(detail.message);
    this.name = "PromptFailureError";
    this.detail = detail;
    this.status = status;
  }
}
export const invalidPromptRequest = () =>
  new PromptFailureError(
    {
      code: "validation_failed",
      message: "Check the request fields and limits.",
      retryable: false,
    },
    400
  );
export const promptFailure = (error: Error): PromptFailureError => {
  if (error instanceof PromptFailureError) {
    return error;
  }
  if (error instanceof AccountFailureError) {
    if (error.code === "unauthenticated") {
      return new PromptFailureError(
        {
          code: "authentication_required",
          message:
            "Sign in to the same account to retry. Keep this tab open to retain your draft.",
          retryable: true,
        },
        401
      );
    }
    if (error.code === "forbidden" || error.code === "email_unverified") {
      return new PromptFailureError(
        {
          code: "forbidden",
          message: "A verified browser session for this library is required.",
          retryable: false,
        },
        403
      );
    }
    if (error.code === "rate_limited") {
      return new PromptFailureError(
        {
          code: "rate_limited",
          message: "Too many requests. Wait before retrying.",
          retryable: true,
          retryAfter: error.retryAfter ?? 60,
        },
        429
      );
    }
  }
  return new PromptFailureError(
    {
      code: "temporarily_unavailable",
      message:
        "The server could not confirm saving. Keep this tab open and retry.",
      retryable: true,
      retryAfter: 30,
    },
    503
  );
};
export const promptErrorResponse = (error: Error) => {
  const failure = promptFailure(error);
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  if (failure.detail.retryAfter) {
    headers.set("Retry-After", String(failure.detail.retryAfter));
  }
  return Response.json(promptErrorSchema.parse(failure.detail), {
    status: failure.status,
    headers,
  });
};
