import { desktopSearchPageSchema } from "@pr0/api-contract/desktop-search";
// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- A diagnostic replay drives actual native requests in sequence.
import { desktopStatusSchema } from "@pr0/api-contract/desktop-session";

const sleep = async (ms: number) => {
  const timeout = Promise.withResolvers<undefined>();
  setTimeout(() => timeout.resolve(), ms);
  await timeout.promise;
};
const run = async () => {
  let completedQueries = 0;
  const emit = async (phase: string, error = "") =>
    await window.__TAURI_INTERNALS__.invoke("capacity_probe", {
      evidence: {
        phase,
        at: Date.now(),
        completedQueries,
        error,
        elements: document.querySelectorAll("*").length,
      },
    });
  try {
    const deadline = Date.now() + 30_000;
    while (
      document.querySelectorAll('ul[aria-label="Search results"] > li')
        .length !== 50
    ) {
      if (Date.now() > deadline) {
        throw new Error("Maximum library UI did not become ready");
      }
      await sleep(20);
    }
    // This script initializes before document CSP; avoid caching an early eval allowance.
    const account = desktopStatusSchema.parse(
      await window.__TAURI_INTERNALS__.invoke("auth_status", {}),
      { jitless: true }
    );
    if (!account.instanceId || !account.accountId) {
      throw new Error("Native account is missing");
    }
    await emit("ready");
    await sleep(1000);
    await emit("query-start");
    for (let index = 0; index < 100; index += 1) {
      const page = desktopSearchPageSchema.parse(
        await window.__TAURI_INTERNALS__.invoke("library_search", {
          request: {
            instanceId: account.instanceId,
            accountId: account.accountId,
            generation: account.generation,
            requestId: crypto.randomUUID(),
            query: "a",
            limit: 50,
            view: "all",
            sort: "relevance",
            tagIds: [],
          },
        }),
        { jitless: true }
      );
      if (
        page.prompts.length !== 50 ||
        page.tags.length !== 1000 ||
        page.collections.length !== 200
      ) {
        throw new Error(
          "Native search response differs from the maximum fixture"
        );
      }
      completedQueries += 1;
    }
    await emit("queried");
    await window.__TAURI_INTERNALS__.invoke("resident_hide", {});
    await sleep(30_000);
    await emit("hidden");
  } catch (error) {
    await emit("failed", String(error));
  }
};
void run();
