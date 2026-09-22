import { useEffect, useEffectEvent } from "react";

import { libraryClient } from "./library-client";
import { listenWhenVisible, surfaceVisible } from "./surface-visibility";

export const useLibraryRefresh = (refresh: () => void) => {
  const onRefresh = useEffectEvent(refresh);
  useEffect(() => {
    const handleRefresh = () => {
      if (surfaceVisible()) {
        onRefresh();
      }
    };
    let disposed = false;
    let stop: (() => void) | undefined;
    const subscribe = async () => {
      try {
        const unlisten = await listenWhenVisible(
          "library-changed",
          handleRefresh
        );
        if (disposed) {
          unlisten();
        } else {
          stop = unlisten;
        }
      } catch {
        // Focus and explicit retry still refresh authoritative state if event registration fails.
      }
    };
    void subscribe();
    window.addEventListener("focus", handleRefresh);
    const wake = () => {
      void (async () => {
        try {
          await libraryClient.sync();
        } catch {
          // Native retries preserve authoritative state.
        }
      })();
      handleRefresh();
    };
    window.addEventListener("online", wake);
    return () => {
      disposed = true;
      stop?.();
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("online", wake);
    };
  }, []);
};
