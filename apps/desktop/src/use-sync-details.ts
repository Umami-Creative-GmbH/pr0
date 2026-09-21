import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

export const useSyncDetails = () => {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    const subscribe = async () => {
      try {
        const unlisten = await listen("show-sync-details", () => {
          if (details.current) {
            details.current.open = true;
            details.current.querySelector("summary")?.focus();
          }
        });
        if (disposed) {
          unlisten();
        } else {
          stop = unlisten;
        }
      } catch {
        // The details disclosure remains directly available in the library.
      }
    };
    void subscribe();
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  return details;
};
