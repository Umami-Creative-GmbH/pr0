import type {
  ResidentAction,
  ResidentStatus,
} from "@pr0/api-contract/desktop-resident";
import { listen } from "@tauri-apps/api/event";
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
      className="bg-background text-foreground m-auto max-w-lg space-y-4 rounded border p-6 backdrop:bg-black/40"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
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
  const quitting = useRef(false);
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
      quitting.current = false;
      return;
    }
    if (quitting.current) {
      return;
    }
    quitting.current = true;
    const resolve = async () => {
      setWaiting(true);
      try {
        // Await the renderer acknowledgement too: native completion alone does
        // not certify a draft edited while that save was in flight.
        const { current } = editor;
        const pending = current?.pending();
        if (pending) {
          await pending;
        }
        if (!editor.current?.hasChanges()) {
          await residentClient.finishQuit();
        }
      } catch {
        setError(
          "The save or quit could not be confirmed. Your draft remains open."
        );
      }
      setWaiting(false);
    };
    void resolve();
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
      <nav
        aria-label="Desktop controls"
        className="mx-auto flex max-w-xl gap-4 px-8 pt-4"
      >
        <button type="button" onClick={() => action("settings")}>
          Settings
        </button>
        <button type="button" onClick={() => action("quit")}>
          Quit pr0
        </button>
      </nav>
      {children}
      {error &&
      !status?.quitRequested &&
      !status?.closeNotice &&
      !status?.settings ? (
        <p role="alert">
          {error}{" "}
          <button
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
              type="button"
              disabled={waiting}
              onClick={() => {
                void saveAndQuit();
              }}
            >
              Save and quit
            </button>
            <button
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
