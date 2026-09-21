import { PromptApiError } from "@pr0/api-client/prompts";
import type { QueryClient } from "@tanstack/react-query";

const refreshes = new WeakMap<
  QueryClient,
  Map<string, { dirty: boolean; promise: Promise<void> }>
>();

const refreshQueries = async (client: QueryClient, scope: string[]) => {
  await Promise.all(
    ["prompt", "prompts", "organization", "conflicts"].map(async (kind) => {
      await client.cancelQueries({ queryKey: [kind, ...scope] });
    })
  );
  await client.invalidateQueries(
    { queryKey: ["prompt", ...scope] },
    { cancelRefetch: false }
  );
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: ["prompt", ...scope] })) {
    const { error } = query.state;
    if (
      query.isActive() &&
      error &&
      !(error instanceof PromptApiError && error.status === 404)
    ) {
      throw error;
    }
  }
  // Infinite queries refetch from the first page using fresh continuation cursors.
  // Keep the previous rows mounted until their complete replacement is available.
  await client.invalidateQueries(
    { queryKey: ["prompts", ...scope] },
    { throwOnError: true, cancelRefetch: false }
  );
  await client.invalidateQueries(
    { queryKey: ["organization", ...scope] },
    { throwOnError: true, cancelRefetch: false }
  );
  await client.invalidateQueries(
    { queryKey: ["conflicts", ...scope] },
    { throwOnError: true, cancelRefetch: false }
  );
};

export const refreshLibrary = async (client: QueryClient, scope: string[]) => {
  const entries = refreshes.get(client) ?? new Map();
  refreshes.set(client, entries);
  const key = JSON.stringify(scope);
  const current = entries.get(key);
  if (current) {
    current.dirty = true;
    await current.promise;
    return;
  }
  const state = { dirty: true, promise: Promise.resolve() };
  entries.set(key, state);
  state.promise = (async () => {
    try {
      while (state.dirty) {
        state.dirty = false;
        // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Coalesce concurrent refreshes, then cover changes that arrived during the preceding reads.
        await refreshQueries(client, scope);
      }
    } finally {
      entries.delete(key);
    }
  })();
  await state.promise;
};
