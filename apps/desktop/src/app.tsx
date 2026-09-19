/**
 * PROTOTYPE (issue #9) — desktop main window.
 *
 * Owns the library and mirrors it into the native launcher window over Tauri
 * events. Throwaway: nothing is persisted and there is no API call.
 */

import type { ClipboardWriter } from "@pr0/prototype-library/domain/copy";
import { recordUse } from "@pr0/prototype-library/domain/lifecycle";
import { createSeedLibrary } from "@pr0/prototype-library/domain/seed";
import type { Library } from "@pr0/prototype-library/domain/types";
import { PrototypeShell } from "@pr0/prototype-library/ui/prototype-shell";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LauncherUsedPayload } from "./prototype-bridge";
import { PROTOTYPE_EVENTS, relay } from "./prototype-bridge";

import "@pr0/prototype-library/prototype.css";

// Captured once at load so relative dates do not drift during a session.
const SESSION_NOW = Date.now();

export const App = () => {
  const [library, setLibrary] = useState<Library>(() =>
    createSeedLibrary(SESSION_NOW)
  );
  const [clipboardFails, setClipboardFails] = useState(false);
  // undefined until the setup command answers; null means none registered.
  const [shortcutLabel, setShortcutLabel] = useState<
    string | null | undefined
  >();

  // The relay handlers need the current library without re-subscribing.
  const libraryRef = useRef(library);
  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  const update = useCallback((next: Library) => {
    setLibrary(next);
    void relay(PROTOTYPE_EVENTS.librarySync, next);
  }, []);

  useEffect(() => {
    const loadShortcut = async () => {
      const label = await invoke<string | null>("registered_shortcut");
      setShortcutLabel(label ?? null);
    };
    void loadShortcut();

    const unlisteners = [
      listen(PROTOTYPE_EVENTS.libraryRequest, () =>
        relay(PROTOTYPE_EVENTS.librarySync, libraryRef.current)
      ),
      listen<LauncherUsedPayload>(PROTOTYPE_EVENTS.launcherUsed, (event) => {
        // The launcher already wrote to the clipboard, so this is a use.
        const next = recordUse(
          libraryRef.current,
          event.payload.promptId,
          event.payload.at
        );
        setLibrary(next);
        void relay(PROTOTYPE_EVENTS.librarySync, next);
      }),
    ];

    return () => {
      for (const pending of unlisteners) {
        void (async () => {
          const off = await pending;
          off();
        })();
      }
    };
  }, []);

  const clipboard: ClipboardWriter = useMemo(
    () => async (text: string) => {
      if (clipboardFails) {
        throw new Error("clipboard blocked (prototype tool)");
      }
      await writeText(text);
    },
    [clipboardFails]
  );

  return (
    <PrototypeShell
      clipboard={clipboard}
      clipboardFails={clipboardFails}
      fixedSurface
      initialSurface="desktop"
      launcherIsNative
      library={library}
      now={SESSION_NOW}
      onClipboardFailureChange={setClipboardFails}
      onLibraryChange={update}
      onOpenNativeLauncher={() => {
        void invoke("open_launcher");
      }}
      shortcutLabel={shortcutLabel}
    />
  );
};
