// oxlint-disable unicorn/require-post-message-target-origin -- This is a Bun worker, not a browser window.
import { PromptFailureError } from "../src/server/prompt-errors";
import { searchProjection } from "../src/server/search-projection";
import type { SearchJob } from "../src/server/search-types";

declare const self: Worker;
self.addEventListener("message", async (event: MessageEvent<SearchJob>) => {
  try {
    self.postMessage({ result: await searchProjection(event.data) });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof PromptFailureError
          ? { detail: error.detail, status: error.status }
          : null,
    });
  }
});
