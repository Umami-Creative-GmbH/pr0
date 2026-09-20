"use client";

import { deletionTrustSchema } from "@pr0/api-contract/deletions";
import type { DeletionTrust } from "@pr0/api-contract/deletions";
import { useCallback, useMemo, useSyncExternalStore } from "react";

const changed = "pr0-deletion-recovery";
const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener(changed, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(changed, notify);
  };
};
const serverSnapshot = () => null;

export const useDeletionRecovery = (baseUrl: string) => {
  const key = `pr0:deletion:${baseUrl}`;
  const snapshot = useCallback(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const pending = useMemo(() => {
    try {
      return value ? deletionTrustSchema.parse(JSON.parse(value)) : null;
    } catch {
      return null;
    }
  }, [value]);
  const persist = (trust: DeletionTrust | null) => {
    // Failure must stop submission: the removed session cannot recover this anchor.
    if (trust) {
      localStorage.setItem(key, JSON.stringify(trust));
    } else {
      localStorage.removeItem(key);
    }
    window.dispatchEvent(new Event(changed));
  };
  return { pending, persist };
};
