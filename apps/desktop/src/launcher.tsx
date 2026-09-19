/**
 * PROTOTYPE (issue #9) — the native quick launcher window.
 *
 * The main window owns the library; this window mirrors it over Tauri events
 * so a copy here updates recency there. Nothing persists.
 */

import { createSeedLibrary } from "@pr0/prototype-library/domain/seed";
import type { Library, PromptId } from "@pr0/prototype-library/domain/types";
import { PrototypeI18nProvider } from "@pr0/prototype-library/ui/i18n-provider";
import { LauncherPanel } from "@pr0/prototype-library/ui/launcher-panel";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "@pr0/prototype-library/prototype.css";

/** Payloads crossing the Tauri window boundary. */
type RelayPayload = Library | { promptId: string; at: number } | null;

const relay = (event: string, payload: RelayPayload = null) =>
  invoke("relay", { event, payload });

const LauncherWindow = () => {
  const [library, setLibrary] = useState<Library>(() =>
    createSeedLibrary(Date.now())
  );
  // Remounts the panel on every opening, which is how the reset of query and
  // filters required by issue #7 happens.
  const [opening, setOpening] = useState(0);

  useEffect(() => {
    const unlisteners = [
      listen<Library>("library:sync", (event) => setLibrary(event.payload)),
      listen("launcher:opened", () => setOpening((count) => count + 1)),
    ];

    void relay("launcher:request-library");

    return () => {
      for (const pending of unlisteners) {
        void (async () => {
          const off = await pending;
          off();
        })();
      }
    };
  }, []);

  const copy = async (promptId: PromptId) => {
    const prompt = library.prompts.find(
      (candidate) => candidate.id === promptId
    );
    if (!prompt) {
      throw new Error("missing-prompt");
    }
    // Throws on failure, which keeps the launcher open with its query.
    await writeText(prompt.content);
    await relay("launcher:used", { promptId, at: Date.now() });
  };

  return (
    <div className="pr0" data-theme="dark" style={{ height: "100vh" }}>
      <LauncherPanel
        key={opening}
        library={library}
        onClose={() => {
          void invoke("hide_launcher");
        }}
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
