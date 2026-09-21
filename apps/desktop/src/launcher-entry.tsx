import { useState } from "react";

import { launcherClient } from "./launcher-client";
import { useLauncherStatus } from "./use-launcher-status";

export const LauncherEntry = () => {
  const { status, error, refresh } = useLauncherStatus();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      setMessage("");
    } catch {
      setMessage("Could not open or update the launcher. Try again.");
    }
    setBusy(false);
  };
  return (
    <section aria-label="Quick launcher" className="wf-launcher-entry">
      <h2 className="sr-only">Quick launcher</h2>
      <p>
        {status
          ? (status.shortcut ?? "Global shortcut unavailable")
          : "Checking shortcut…"}
      </p>
      <button
        type="button"
        className="rounded border p-2"
        disabled={busy}
        onClick={() => {
          void run(launcherClient.open);
        }}
      >
        Open quick launcher
      </button>
      {status?.shortcut ? null : (
        <button
          type="button"
          className="ml-2 rounded border p-2"
          disabled={busy}
          onClick={() => {
            void run(launcherClient.retryShortcut);
          }}
        >
          Retry registration
        </button>
      )}
      <output>{message || error}</output>
    </section>
  );
};
