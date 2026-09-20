import { PromptApiError } from "@pr0/api-client/prompts";

export const retryPromptRead = (failureCount: number, error: Error) =>
  error instanceof PromptApiError &&
  error.detail?.retryable === true &&
  failureCount < 2;
export const promptRetryDelay = (_attempt: number, error: Error) =>
  (error instanceof PromptApiError ? (error.detail?.retryAfter ?? 1) : 1) *
  1000;
