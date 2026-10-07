import type {
  ResidentAction,
  ResidentStatus,
} from "@pr0/api-contract/desktop-resident";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { DialogHead } from "@pr0/ui/components/wayfinder-dialog";
import { AppBarStatus } from "@pr0/ui/components/wayfinder-shell";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
import { listen } from "@tauri-apps/api/event";
import { Power, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { LauncherEntry } from "./launcher-entry";
import { residentClient } from "./resident-client";
import { ResidentEditorContext } from "./resident-editor";
import type { ResidentEditor } from "./resident-editor";
import { StartupControls } from "./startup-controls";
import { UpdateControls } from "./update-controls";

const residencyExplanation = translate(
  "pr0IsStillRunningInTheNotificationAreaUseQuit"
);

const quitLabels = (
  updating: boolean,
  t: ReturnType<typeof useTranslations>
) =>
  updating
    ? {
        title: t("installUpdateAndRestart"),
        save: t("saveAndUpdate"),
        discard: t("discardDraftAndUpdate"),
      }
    : {
        title: t("quitPr0"),
        save: t("saveAndQuit"),
        discard: t("discardAndQuit"),
      };

const ResidentDialog = ({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: ReactNode;
}) => {
  const t = useTranslations();

  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      className="wf-dialog"
      data-size="sm"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <DialogHead eyebrow={t("pr0Desktop")} title={title} />
      <div className="wf-dialog-body">{children}</div>
    </dialog>
  );
};

export const ResidentControls = ({ children }: { children: ReactNode }) => {
  const t = useTranslations();

  const editor = useRef<ResidentEditor | null>(null);
  const registerEditor = useCallback((current: ResidentEditor) => {
    editor.current = current;
    return () => {
      if (editor.current === current) {
        editor.current = null;
      }
    };
  }, []);
  const [status, setStatus] = useState<ResidentStatus>();
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setStatus(await residentClient.status());
    } catch {
      setError(
        translate("desktopControlsAreUnavailableRetryYourDraftRemainsOpen")
      );
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    const connect = async () => {
      try {
        const unsubscribe = await listen("resident-changed", () => {
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
          setError(
            translate("desktopControlsAreUnavailableRetryYourDraftRemainsOpen")
          );
        }
      }
    };
    void connect();
    return () => {
      disposed = true;
      off?.();
    };
  }, [refresh]);
  const perform = useCallback(
    async (operation: () => Promise<void>) => {
      try {
        setError("");
        await operation();
        await refresh();
      } catch {
        setError(
          translate("couldNotCompleteThisActionYourDraftRemainsOpenRetry")
        );
      }
    },
    [refresh]
  );
  const action = (value: ResidentAction) => {
    void perform(async () => {
      await residentClient.action(value);
    });
  };
  useEffect(() => {
    if (!status?.quitRequested) {
      return;
    }
    let cancelled = false;
    const resolve = async () => {
      setWaiting(true);
      try {
        // A pending save certifies only the submitted variant. Recheck the
        // committed editor and this quit request before acting on its result.
        const pending = editor.current?.pending();
        if (pending) {
          await pending;
        }
        if (cancelled) {
          return;
        }
        if (!editor.current?.hasChanges()) {
          await residentClient.finishQuit();
        }
      } catch {
        if (!cancelled) {
          setError(translate("theSaveOrQuitCouldNotBeConfirmedYourDraft"));
        }
      }
      if (!cancelled) {
        setWaiting(false);
      }
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [status?.quitRequested]);
  const saveAndQuit = async () => {
    setWaiting(true);
    setError("");
    try {
      const saved = await editor.current?.save();
      if (saved) {
        await residentClient.finishQuit();
      } else {
        // Reveal the editor's Not saved, Retry and Copy text recovery.
        await residentClient.action("cancel_quit");
        await refresh();
      }
    } catch {
      setError(t("couldNotConfirmSaveAndQuitYourDraftRemainsOpen"));
    }
    setWaiting(false);
  };
  return (
    <ResidentEditorContext value={registerEditor}>
      <AppBarStatus slot="menu">
        <nav aria-label={t("desktopControls")} className="contents">
          <button
            className="wf-menu-item"
            type="button"
            onClick={() => action("settings")}
          >
            <Settings aria-hidden="true" size={15} />
            {t("settings")}
          </button>
          <button
            className="wf-menu-item"
            type="button"
            onClick={() => action("quit")}
          >
            <Power aria-hidden="true" size={15} />
            {t("quitPr0")}
          </button>
        </nav>
      </AppBarStatus>
      <div hidden={status?.settings}>
        <StartupControls offerOnly />
      </div>
      {children}
      <UpdateControls />
      {error &&
      !status?.quitRequested &&
      !status?.closeNotice &&
      !status?.settings ? (
        <p className="wf-banner" role="alert">
          <LocalizedMessage value={error} />{" "}
          <button
            className="wf-link"
            type="button"
            onClick={() => {
              void refresh();
            }}
          >
            {t("retryDesktopControls")}
          </button>
        </p>
      ) : null}
      {status?.quitRequested ? (
        <ResidentDialog
          title={quitLabels(status.updateRequested, t).title}
          onCancel={() => {
            if (!waiting) {
              action("cancel_quit");
            }
          }}
        >
          <p>
            {t("saveYourChangesBeforeQuittingDiscardingLosesTheUnsavedDraft")}
          </p>
          {waiting ? <output>{t("waitingForTheLocalSave")}</output> : null}
          {error ? (
            <p role="alert">
              <LocalizedMessage value={error} />
            </p>
          ) : null}
          <div className="flex flex-wrap gap-4">
            <button
              className="wf-btn-accent"
              type="button"
              disabled={waiting}
              onClick={() => {
                void saveAndQuit();
              }}
            >
              {quitLabels(status.updateRequested, t).save}
            </button>
            <button
              className="wf-btn wf-btn-danger"
              type="button"
              disabled={waiting}
              onClick={() => {
                void perform(residentClient.finishQuit);
              }}
            >
              {quitLabels(status.updateRequested, t).discard}
            </button>
            <button
              type="button"
              disabled={waiting}
              onClick={() => action("cancel_quit")}
            >
              {t("cancel")}
            </button>
          </div>
        </ResidentDialog>
      ) : null}
      {status?.closeNotice ? (
        <ResidentDialog
          title={t("keepPr0Running")}
          onCancel={() => action("cancel_close")}
        >
          <p>{residencyExplanation}</p>
          <p>{t("anUnsavedDraftStaysInMemoryWhilePr0RunsSave")}</p>
          <LauncherEntry />
          {error ? (
            <p role="alert">
              <LocalizedMessage value={error} />
            </p>
          ) : null}
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => {
                void perform(residentClient.hide);
              }}
            >
              {t("hideLibrary")}
            </button>
            <button type="button" onClick={() => action("cancel_close")}>
              {t("keepLibraryOpen")}
            </button>
          </div>
        </ResidentDialog>
      ) : null}
      {status?.settings ? (
        <ResidentDialog
          title={t("settings")}
          onCancel={() => action("close_settings")}
        >
          <StartupControls />
          <p>{residencyExplanation}</p>
          <p>{t("closingTheLibraryKeepsYourUnsavedDraftInMemoryMinimize")}</p>
          <LauncherEntry />
          {error ? (
            <p role="alert">
              <LocalizedMessage value={error} />
            </p>
          ) : null}
          <button type="button" onClick={() => action("close_settings")}>
            {t("closeSettings")}
          </button>
        </ResidentDialog>
      ) : null}
    </ResidentEditorContext>
  );
};
