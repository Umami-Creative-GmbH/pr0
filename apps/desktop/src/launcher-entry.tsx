import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { Command } from "lucide-react";
import { useState } from "react";

import { launcherClient } from "./launcher-client";
import { useLauncherStatus } from "./use-launcher-status";

/** Entry to the native launcher, showing the shortcut Windows actually registered. */
export const LauncherEntry = () => {
  const t = useTranslations();

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
      setMessage(t("couldNotOpenOrUpdateTheLauncherTryAgain"));
    }
    setBusy(false);
  };
  const unavailable = Boolean(status) && !status?.shortcut;
  return (
    <section aria-label={t("quickLauncher")} className="contents">
      <h2 className="sr-only">{t("quickLauncher")}</h2>
      <output className="wf-hint">{message || error}</output>
      <span
        className="wf-shortcut"
        data-state={unavailable ? "unavailable" : undefined}
      >
        <Command aria-hidden="true" size={13} />
        <button
          type="button"
          className="wf-shortcut-action"
          disabled={busy}
          onClick={() => {
            void run(launcherClient.open);
          }}
        >
          {t("openQuickLauncher")}
        </button>
        <span>
          {status
            ? (status.shortcut ?? t("globalShortcutUnavailable"))
            : t("checkingShortcut")}
        </span>
      </span>
      {status?.shortcut ? null : (
        <button
          type="button"
          className="wf-btn-quiet"
          disabled={busy}
          onClick={() => {
            void run(launcherClient.retryShortcut);
          }}
        >
          {t("retryRegistration")}
        </button>
      )}
    </section>
  );
};
