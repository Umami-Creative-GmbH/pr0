import type {
  StartupAction,
  StartupStatus,
} from "@pr0/api-contract/desktop-resident";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { residentClient } from "./resident-client";
import { listenWhenVisible } from "./surface-visibility";

const stateText = {
  enabled: translate("on"),
  disabled: translate("off"),
  disabled_by_windows: translate(
    "disabledByWindowsEnablePr0InWindowsSettingsAppsStartup"
  ),
  unavailable: translate("windowsStartupStateCouldNotBeVerified"),
};

const startupError = (error: string | undefined) => {
  if (error === "startup_disabled_by_windows") {
    return translate("windowsHasDisabledThisStartupEntryEnablePr0InWindows");
  }
  if (error === "startup_path_too_long") {
    return translate("theApplicationPathIsTooLongForWindowsStartupInstall");
  }
  if (error === "storage_unavailable") {
    return translate("couldNotSaveYourFirstRunChoiceCheckDiskAccess");
  }
  return translate(
    "couldNotConfirmTheStartupChangeCheckWindowsStartupSettings"
  );
};

export const StartupControls = ({
  offerOnly = false,
}: {
  offerOnly?: boolean;
}) => {
  const t = useTranslations();

  const [status, setStatus] = useState<StartupStatus>();
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const refresh = useCallback(async () => {
    try {
      setStatus(await residentClient.startupStatus());
    } catch {
      setErrorText(
        translate("couldNotReadWindowsStartupStateCheckAgainToRetry")
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
    <section aria-label={t("startAtLogin")} className="wf-card">
      <h2>{t("startAtLogin")}</h2>
      <p>{t("openPr0QuietlyInTheNotificationAreaWhenYouSign")}</p>
      {offerOnly ? (
        <p>{t("thisIsOptionalAndOffByDefaultYouCanChange")}</p>
      ) : null}
      <output aria-live="polite">
        {status ? stateText[status.state] : t("checkingWindowsStartup")}
      </output>
      {errorText ? (
        <p role="alert">
          <LocalizedMessage value={errorText} />
        </p>
      ) : null}
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
            ? t("disableStartAtLogin")
            : t("enableStartAtLogin")}
        </button>
        <button
          type="button"
          className="wf-btn"
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
        >
          {t("checkAgain")}
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
            {status?.state === "enabled" ? t("done") : t("notNow")}
          </button>
        ) : null}
      </div>
    </section>
  );
};
