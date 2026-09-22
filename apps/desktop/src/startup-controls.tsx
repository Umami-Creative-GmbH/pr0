import type {
  StartupAction,
  StartupStatus,
} from "@pr0/api-contract/desktop-resident";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { residentClient } from "./resident-client";
import { listenWhenVisible } from "./surface-visibility";

const stateText = {
  enabled: "On",
  disabled: "Off",
  disabled_by_windows:
    "Disabled by Windows. Enable pr0 in Windows Settings → Apps → Startup.",
  unavailable: "Windows startup state could not be verified.",
};

const startupError = (error: string | undefined) => {
  if (error === "startup_disabled_by_windows") {
    return "Windows has disabled this startup entry. Enable pr0 in Windows Settings → Apps → Startup, then check again.";
  }
  if (error === "startup_path_too_long") {
    return "The application path is too long for Windows startup. Install pr0 in a shorter path and retry.";
  }
  if (error === "storage_unavailable") {
    return "Could not save your first-run choice. Check disk access and retry.";
  }
  return "Could not confirm the startup change. Check Windows startup settings and retry.";
};

export const StartupControls = ({
  offerOnly = false,
}: {
  offerOnly?: boolean;
}) => {
  const [status, setStatus] = useState<StartupStatus>();
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const refresh = useCallback(async () => {
    try {
      setStatus(await residentClient.startupStatus());
    } catch {
      setErrorText(
        "Could not read Windows startup state. Check again to retry."
      );
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    const connect = async () => {
      try {
        const off = await listenWhenVisible("startup-changed", () => {
          void refresh();
        });
        if (disposed) {
          off();
          return;
        }
        stop = off;
        await refresh();
      } catch {
        if (!disposed) {
          await refresh();
        }
      }
    };
    void connect();
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      stop?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  const act = async (action: StartupAction) => {
    setBusy(true);
    setErrorText("");
    try {
      setStatus(await residentClient.startupAction(action));
    } catch (error) {
      await refresh();
      setErrorText(startupError(z.string().safeParse(error).data));
    }
    setBusy(false);
  };
  if (offerOnly && ((!status && !errorText) || (status && !status.offer))) {
    return null;
  }
  return (
    <section aria-label="Start at login" className="wf-card">
      <h2>Start at login</h2>
      <p>
        Open pr0 quietly in the notification area when you sign into Windows.
        Your library opens when you ask for it.
      </p>
      {offerOnly ? (
        <p>
          This is optional and off by default. You can change it later in
          Settings.
        </p>
      ) : null}
      <output aria-live="polite">
        {status ? stateText[status.state] : "Checking Windows startup…"}
      </output>
      {errorText ? <p role="alert">{errorText}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="wf-btn"
          disabled={busy || !status}
          onClick={() => {
            void act(status?.state === "enabled" ? "disable" : "enable");
          }}
        >
          {status?.state === "enabled"
            ? "Disable Start at login"
            : "Enable Start at login"}
        </button>
        <button
          type="button"
          className="wf-btn"
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
        >
          Check again
        </button>
        {offerOnly ? (
          <button
            type="button"
            className="wf-btn"
            disabled={busy || !status}
            onClick={() => {
              void act("dismiss_offer");
            }}
          >
            {status?.state === "enabled" ? "Done" : "Not now"}
          </button>
        ) : null}
      </div>
    </section>
  );
};
