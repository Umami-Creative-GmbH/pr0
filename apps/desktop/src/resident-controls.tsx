import type {
  ResidentAction,
  ResidentStatus,
} from "@pr0/api-contract/desktop-resident";
import { DialogHead } from "@pr0/ui/components/wayfinder-dialog";
import { AppBarStatus } from "@pr0/ui/components/wayfinder-shell";
import { listen } from "@tauri-apps/api/event";
import { Power, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { LauncherEntry } from "./launcher-entry";
import { residentClient } from "./resident-client";
import { ResidentEditorContext } from "./resident-editor";
import type { ResidentEditor } from "./resident-editor";

const residencyExplanation =
  "pr0 is still running in the notification area. Use Quit pr0 to exit; its global shortcut stops working when you quit.";

const ResidentDialog = ({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: ReactNode;
}) => {
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
      <DialogHead eyebrow="pr0 desktop" title={title} />
      <div className="wf-dialog-body">{children}</div>
    </dialog>
  );
};

export const ResidentControls = ({ children }: { children: ReactNode }) => {
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
        "Desktop controls are unavailable. Retry; your draft remains open."
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
            "Desktop controls are unavailable. Retry; your draft remains open."
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
          "Could not complete this action. Your draft remains open; retry or cancel."
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
          setError(
            "The save or quit could not be confirmed. Your draft remains open."
          );
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
      setError(
        "Could not confirm Save and quit. Your draft remains open; cancel to review it."
      );
    }
    setWaiting(false);
  };
  return (
    <ResidentEditorContext value={registerEditor}>
      <AppBarStatus>
        <nav aria-label="Desktop controls" className="contents">
          <button
            aria-label="Settings"
            className="wf-icon-btn"
            data-size="md"
            type="button"
            onClick={() => action("settings")}
          >
            <Settings aria-hidden="true" size={15} />
          </button>
          <button
            aria-label="Quit pr0"
            className="wf-icon-btn"
            data-size="md"
            type="button"
            onClick={() => action("quit")}
          >
            <Power aria-hidden="true" size={15} />
          </button>
        </nav>
      </AppBarStatus>
      {children}
      {error &&
      !status?.quitRequested &&
      !status?.closeNotice &&
      !status?.settings ? (
        <p className="wf-banner" role="alert">
          {error}{" "}
          <button
            className="wf-link"
            type="button"
            onClick={() => {
              void refresh();
            }}
          >
            Retry desktop controls
          </button>
        </p>
      ) : null}
      {status?.quitRequested ? (
        <ResidentDialog
          title="Quit pr0"
          onCancel={() => {
            if (!waiting) {
              action("cancel_quit");
            }
          }}
        >
          <p>
            Save your changes before quitting? Discarding loses the unsaved
            draft. Earlier saved work and changes waiting to sync stay on this
            device.
          </p>
          {waiting ? <output>Waiting for the local save…</output> : null}
          {error ? <p role="alert">{error}</p> : null}
          <div className="flex flex-wrap gap-4">
            <button
              className="wf-btn-accent"
              type="button"
              disabled={waiting}
              onClick={() => {
                void saveAndQuit();
              }}
            >
              Save and quit
            </button>
            <button
              className="wf-btn wf-btn-danger"
              type="button"
              disabled={waiting}
              onClick={() => {
                void perform(residentClient.finishQuit);
              }}
            >
              Discard and quit
            </button>
            <button
              type="button"
              disabled={waiting}
              onClick={() => action("cancel_quit")}
            >
              Cancel
            </button>
          </div>
        </ResidentDialog>
      ) : null}
      {status?.closeNotice ? (
        <ResidentDialog
          title="Keep pr0 running"
          onCancel={() => action("cancel_close")}
        >
          <p>{residencyExplanation}</p>
          <p>
            An unsaved draft stays in memory while pr0 runs. Save it to keep it
            after a restart.
          </p>
          <LauncherEntry />
          {error ? <p role="alert">{error}</p> : null}
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => {
                void perform(residentClient.hide);
              }}
            >
              Hide library
            </button>
            <button type="button" onClick={() => action("cancel_close")}>
              Keep library open
            </button>
          </div>
        </ResidentDialog>
      ) : null}
      {status?.settings ? (
        <ResidentDialog
          title="Settings"
          onCancel={() => action("close_settings")}
        >
          <p>{residencyExplanation}</p>
          <p>
            Closing the library keeps your unsaved draft in memory. Minimize
            works normally. Use Windows notification-area overflow to find pr0;
            with the keyboard, press Win+B and open its menu. Open library, Open
            quick launcher, Settings and Quit pr0 are available there.
          </p>
          <LauncherEntry />
          {error ? <p role="alert">{error}</p> : null}
          <button type="button" onClick={() => action("close_settings")}>
            Close Settings
          </button>
        </ResidentDialog>
      ) : null}
    </ResidentEditorContext>
  );
};
