/**
 * PROTOTYPE (issue #9) — the native quick launcher window.
 *
 * The main window owns the library; this window mirrors it over Tauri events
 * so a copy here updates recency there. Nothing persists.
 *
 * Asking for variable values lives in LauncherPanel, shared with the web
 * surface, so both close only after a successful clipboard write.
 */

import { createSeedLibrary } from "@pr0/prototype-library/domain/seed";
import type { Library, PromptId } from "@pr0/prototype-library/domain/types";
import { resolveVariables } from "@pr0/prototype-library/domain/variables";
import { PrototypeI18nProvider } from "@pr0/prototype-library/ui/i18n-provider";
import { LauncherPanel } from "@pr0/prototype-library/ui/launcher-panel";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { PROTOTYPE_EVENTS, relay } from "./prototype-bridge";

import "@pr0/prototype-library/prototype.css";

const LAUNCHER_WIDTH = 660;

const close = () => {
  void invoke("hide_launcher");
};

const LauncherWindow = () => {
  const [library, setLibrary] = useState<Library>(() =>
    createSeedLibrary(Date.now())
  );
  // Remounts the panel on every opening, which is how the reset of query and
  // filters required by issue #7 happens.
  const [opening, setOpening] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // The window is borderless and transparent, so any height beyond the panel
  // shows straight through to whatever is behind it. Keep them the same size.
  //
  // Measured off the panel itself rather than its host: the host is stretched
  // to the window, so measuring it would only read back the size we just set.
  const lastHeight = useRef(0);
  useEffect(() => {
    const host = panelRef.current;
    if (!host) {
      return;
    }

    const apply = () => {
      const panel = host.firstElementChild;
      if (!panel) {
        return;
      }
      const height = Math.ceil(panel.getBoundingClientRect().height);
      if (height > 0 && height !== lastHeight.current) {
        lastHeight.current = height;
        void getCurrentWindow().setSize(
          new LogicalSize(LAUNCHER_WIDTH, height)
        );
      }
    };

    const observer = new ResizeObserver(apply);
    observer.observe(host);
    if (host.firstElementChild) {
      observer.observe(host.firstElementChild);
    }
    // Fonts and the initial layout settle a frame late.
    const frame = requestAnimationFrame(apply);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });

  useEffect(() => {
    const unlisteners = [
      listen<Library>(PROTOTYPE_EVENTS.librarySync, (event) =>
        setLibrary(event.payload)
      ),
      listen(PROTOTYPE_EVENTS.launcherOpened, () =>
        setOpening((count) => count + 1)
      ),
    ];

    void relay(PROTOTYPE_EVENTS.libraryRequest);

    return () => {
      for (const pending of unlisteners) {
        void (async () => {
          const off = await pending;
          off();
        })();
      }
    };
  }, []);

  /** Throws on failure, which keeps the launcher open with its query. */
  const copy = async (
    promptId: PromptId,
    variableValues?: Record<string, string>
  ) => {
    const prompt = library.prompts.find(
      (candidate) => candidate.id === promptId
    );
    if (!prompt) {
      throw new Error("missing-prompt");
    }
    const text = variableValues
      ? resolveVariables(prompt.content, variableValues)
      : prompt.content;

    await writeText(text);
    await relay(PROTOTYPE_EVENTS.launcherUsed, {
      promptId: prompt.id,
      at: Date.now(),
    });
  };

  return (
    <div className="pr0 pr0-window" data-theme="dark" ref={panelRef}>
      <LauncherPanel
        key={opening}
        library={library}
        onClose={close}
        onCopy={copy}
        standalone
      />
    </div>
  );
};

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing launcher root element");
}

createRoot(root).render(
  <StrictMode>
    <PrototypeI18nProvider>
      <LauncherWindow />
    </PrototypeI18nProvider>
  </StrictMode>
);
