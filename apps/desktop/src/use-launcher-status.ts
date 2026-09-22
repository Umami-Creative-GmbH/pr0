import type { LauncherStatus } from "@pr0/api-contract/desktop-launcher";
import { translate } from "@pr0/ui/lib/i18n";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { launcherClient } from "./launcher-client";
import { listenWhenVisible } from "./surface-visibility";

export const useLauncherStatus = () => {
  const [status, setStatus] = useState<LauncherStatus>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const request = useRef(0);
  const refresh = useCallback(async () => {
    request.current += 1;
    const attempt = request.current;
    try {
      const next = await launcherClient.status();
      if (attempt === request.current) {
        setStatus(next);
        setError(
          next.error
            ? translate("yourLocalLibraryCouldNotBeOpenedOpenTheLibrary")
            : ""
        );
      }
    } catch {
      if (attempt === request.current) {
        setError(translate("launcherStatusUnavailableRetryOrReopenPr0"));
      }
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    const off: (() => void)[] = [];
    const changed = (event: string) => {
      if (disposed) {
        return;
      }
      if (event !== "launcher-changed") {
        setRevision((value) => value + 1);
      }
      void refresh();
    };
    const connect = async () => {
      try {
        for (const event of [
          "launcher-changed",
          "library-changed",
          "auth-changed",
        ]) {
          // Events carry invalidation only; native status and storage own the data.
          const subscribe =
            event === "launcher-changed" ? listen : listenWhenVisible;
          // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Register and clean up each native subscription in order.
          const unsubscribe = await subscribe(event, () => changed(event));
          if (disposed) {
            unsubscribe();
          } else {
            off.push(unsubscribe);
          }
        }
        if (!disposed) {
          await refresh();
        }
      } catch {
        if (!disposed) {
          setError(translate("launcherUpdatesUnavailableRetryOrReopenPr0"));
        }
      }
    };
    void connect();
    return () => {
      disposed = true;
      request.current += 1;
      for (const unsubscribe of off) {
        unsubscribe();
      }
    };
  }, [refresh]);
  return { status, revision, error, refresh };
};
