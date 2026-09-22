import type { UpdateStatus } from "@pr0/api-contract/desktop-update";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import { updateClient } from "./update-client";

export const useApplicationUpdates = () => {
  const [status, setStatus] = useState<UpdateStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setStatus(await updateClient.status());
    } catch {
      setError("Update controls are unavailable. Retry.");
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    const connect = async () => {
      try {
        const unsubscribe = await listen("update-changed", () => {
          void refresh();
        });
        if (disposed) {
          unsubscribe();
          return;
        }
        off = unsubscribe;
        await refresh();
      } catch {
        if (!disposed) {
          setError("Update controls are unavailable. Retry.");
        }
      }
    };
    void connect();
    return () => {
      disposed = true;
      off?.();
    };
  }, [refresh]);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch {
      setError(
        "Could not complete the update action. Retry; your work remains available."
      );
    }
    setBusy(false);
  };
  return { status, busy, error, perform };
};
