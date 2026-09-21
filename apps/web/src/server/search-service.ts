// oxlint-disable unicorn/require-post-message-target-origin -- Messages target a Bun worker, not a browser window.
import "server-only";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { promptPageSchema, promptErrorSchema } from "@pr0/api-contract/prompts";
import { z } from "zod";

import type { BrowserAccount } from "./browser-proof";
import { database } from "./database";
import { PromptFailureError } from "./prompt-errors";
import { lockLibrary } from "./prompt-store";
import type { SearchInput, SearchJob, SearchPage } from "./search-types";
import { withSearchWork } from "./search-work";

const preparing = () =>
  new PromptFailureError(
    {
      code: "search_preparing",
      message: "Search is preparing your latest library. Try again shortly.",
      retryable: true,
      retryAfter: 1,
    },
    503
  );
const replySchema = z.object({
  result: z
    .object({
      page: promptPageSchema,
      timing: z.object({
        indexMs: z.number(),
        queryMs: z.number(),
        indexed: z.number(),
        checkedBodies: z.number(),
        fetchedBytes: z.number(),
        candidates: z.number(),
      }),
    })
    .optional(),
  error: z
    .object({ detail: promptErrorSchema, status: z.number() })
    .nullable()
    .optional(),
});
interface SearchWorker {
  worker: Worker;
  busy: boolean;
}
const workers: (SearchWorker | undefined)[] = [];
const runSearch = (
  job: SearchJob,
  signal: AbortSignal
): Promise<{ page: SearchPage; timing: string }> => {
  const slot = workers[0]?.busy ? 1 : 0;
  let owner = workers[slot];
  if (!owner) {
    owner = {
      worker: new Worker(
        pathToFileURL(path.resolve(".operations/search-worker.js")).href
      ),
      busy: false,
    };
    workers[slot] = owner;
  }
  if (owner.busy || signal.aborted) {
    return Promise.reject(preparing());
  }
  const current = owner;
  current.busy = true;
  // oxlint-disable-next-line promise/avoid-new -- Adapt worker messages and request cancellation to a bounded asynchronous request.
  return new Promise((resolve, reject) => {
    const listeners = new AbortController();
    const cleanup = () => {
      current.busy = false;
      listeners.abort();
    };
    const handleMessage = (event: MessageEvent<unknown>) => {
      cleanup();
      const parsed = replySchema.safeParse(event.data);
      if (!parsed.success) {
        reject(preparing());
        return;
      }
      if (parsed.data.result) {
        const { page, timing } = parsed.data.result;
        resolve({
          page,
          timing: `search-index;dur=${timing.indexMs.toFixed(2)}, search-query;dur=${timing.queryMs.toFixed(2)}, search-updates;desc="${timing.indexed}", search-bodies;desc="${timing.checkedBodies}", search-bytes;desc="${timing.fetchedBytes}"`,
        });
      } else if (parsed.data.error) {
        reject(
          new PromptFailureError(
            parsed.data.error.detail,
            parsed.data.error.status
          )
        );
      } else {
        reject(preparing());
      }
    };
    const handleError = () => {
      cleanup();
      current.worker.terminate();
      workers[slot] = undefined;
      reject(preparing());
    };
    signal.addEventListener(
      "abort",
      () => {
        Atomics.store(new Int32Array(job.cancellation), 0, 1);
        handleError();
      },
      { once: true, signal: listeners.signal }
    );
    current.worker.addEventListener("message", handleMessage, {
      once: true,
      signal: listeners.signal,
    });
    current.worker.addEventListener("error", handleError, {
      once: true,
      signal: listeners.signal,
    });
    current.worker.postMessage(job);
  });
};
export const searchPrompts = async (
  browser: BrowserAccount,
  input: SearchInput,
  signal: AbortSignal
) => {
  const library = await database().begin((tx) => lockLibrary(tx, browser));
  const job = {
    input,
    cancellation: new SharedArrayBuffer(4),
    scope: {
      instance: library.instance_id,
      account: browser.accountId,
      epoch: library.recovery_epoch,
      revision: library.revision,
    },
  };
  const pending = withSearchWork(browser.accountId, signal, () =>
    runSearch(job, signal)
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result;
  try {
    // A cold rebuild may continue, but keeps its global worker slot until completion.
    const timeout = Promise.withResolvers<never>();
    timer = setTimeout(() => timeout.reject(preparing()), 4000);
    result = await Promise.race([pending, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
  // Delayed responses must still belong to an active session and the admitted recovery generation.
  const current = await database().begin((tx) => lockLibrary(tx, browser));
  if (current.recovery_epoch !== library.recovery_epoch || signal.aborted) {
    throw preparing();
  }
  return result;
};
