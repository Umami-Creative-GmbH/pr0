import type { UpdateStatus } from "@pr0/api-contract/desktop-update";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import { updateClient } from "./update-client";

const errors = {
  check_failed: "Could not check for updates. Check your connection and retry.",
  download_failed:
    "The download failed. Your saved work is unchanged. Retry the download.",
  verification_failed:
    "The update signature could not be verified. Nothing was installed. Retry later or contact your application distributor.",
  install_failed:
    "The update did not complete. Your local library and pending work remain on this device. Retry, or quit pr0 and run the signed installer from your application distributor.",
  storage_unavailable:
    "Could not prepare the update on this device. Check available disk space and access, then retry.",
};

export const UpdateControls = () => {
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
  const phase = status?.phase;
  return (
    <section aria-label="Application updates" className="wf-banner">
      <output>
        {status?.version
          ? `pr0 ${status.version} is available. `
          : "Application updates. "}
        {phase === "unconfigured"
          ? "This build has no update signing configuration. Contact your application distributor for a signed release."
          : null}
        {phase === "current" ? "You are up to date." : null}
        {phase === "ready"
          ? "Download verified. Install and restart when you are ready; unsaved changes will be reviewed first."
          : null}
        {busy || phase === "downloading" || phase === "checking"
          ? "Working…"
          : null}
      </output>
      {status?.error ? <p role="alert">{errors[status.error]}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {phase === "available" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void perform(updateClient.download);
          }}
        >
          Download update
        </button>
      ) : null}
      {phase === "ready" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void perform(updateClient.install);
          }}
        >
          Install update and restart
        </button>
      ) : null}
      {phase !== "unconfigured" && phase !== "ready" ? (
        <button
          type="button"
          disabled={busy || phase === "checking" || phase === "downloading"}
          onClick={() => {
            void perform(updateClient.check);
          }}
        >
          Check for updates
        </button>
      ) : null}
    </section>
  );
};
