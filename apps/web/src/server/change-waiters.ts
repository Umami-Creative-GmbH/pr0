import "server-only";
import { AccountFailureError } from "./admission";
import { database } from "./database";

const waiters = new Map<string, Set<() => void>>();
let subscription: Promise<unknown> | undefined;
let count = 0;
const notify = (key: string) => {
  for (const wake of waiters.get(key) ?? []) {
    wake();
  }
};
const listen = async () => {
  try {
    await database().listen("pr0_library_change", notify, () => {
      for (const key of waiters.keys()) {
        notify(key);
      }
    });
  } catch {
    subscription = undefined;
  }
};
const subscribe = () => {
  subscription ??= listen();
  // A failed or reconnecting subscription never replaces periodic committed reads.
  return subscription;
};
export const registerChangeWaiter = (key: string, signal: AbortSignal) => {
  if (count >= 1024 || (waiters.get(key)?.size ?? 0) >= 16) {
    throw new AccountFailureError("unavailable", 503, 5);
  }
  let pending = false;
  let resolve: (() => void) | undefined;
  const wake = () => {
    pending = true;
    resolve?.();
  };
  const entries = waiters.get(key) ?? new Set();
  entries.add(wake);
  waiters.set(key, entries);
  count += 1;
  signal.addEventListener("abort", wake, { once: true });
  void subscribe();
  return {
    wait: async (milliseconds: number) => {
      if (pending || signal.aborted) {
        pending = false;
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const waiting = Promise.withResolvers<undefined>();
        ({ resolve } = waiting);
        timer = setTimeout(() => waiting.resolve(), milliseconds);
        await waiting.promise;
      } finally {
        clearTimeout(timer);
        resolve = undefined;
        pending = false;
      }
    },
    close: () => {
      signal.removeEventListener("abort", wake);
      entries.delete(wake);
      count -= 1;
      if (!entries.size) {
        waiters.delete(key);
      }
    },
  };
};
