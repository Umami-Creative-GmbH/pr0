"use client";

import { deletionIdentitySchema } from "@pr0/api-contract/deletions";
import type { DeletionIdentity } from "@pr0/api-contract/deletions";
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
      return value ? deletionIdentitySchema.parse(JSON.parse(value)) : null;
    } catch {
      return null;
    }
  }, [value]);
  const persist = (identity: DeletionIdentity | null) => {
    // Failure must stop submission: after deletion no session can recover this identity.
    if (identity) {
      localStorage.setItem(key, JSON.stringify(identity));
    } else {
      localStorage.removeItem(key);
    }
    window.dispatchEvent(new Event(changed));
  };
  return { pending, persist };
};
