/**
 * PROTOTYPE (issue #9) — the native quick launcher window.
 *
 * The main window owns the library; this window mirrors it over Tauri events
 * so a copy here updates recency there. Nothing persists.
 *
 * Unlike the in-page launcher, this one asks for variable values *inside* the
 * launcher window, so it closes only after a successful clipboard write. The
 * two surfaces therefore demonstrate both answers to the open question on
 * issue #9 — pick one with the human.
 */

import { createSeedLibrary } from "@pr0/prototype-library/domain/seed";
import type {
  Library,
  Prompt,
  PromptId,
} from "@pr0/prototype-library/domain/types";
import {
  extractVariables,
  resolveVariables,
} from "@pr0/prototype-library/domain/variables";
import { VariablesDialog } from "@pr0/prototype-library/ui/dialogs";
import { PrototypeI18nProvider } from "@pr0/prototype-library/ui/i18n-provider";
import type { LauncherCopyOutcome } from "@pr0/prototype-library/ui/launcher-panel";
import { LauncherPanel } from "@pr0/prototype-library/ui/launcher-panel";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { PROTOTYPE_EVENTS, relay } from "./prototype-bridge";

import "@pr0/prototype-library/prototype.css";

/** Throws on failure, which keeps the launcher open with its query. */
const write = async (prompt: Prompt, text: string) => {
  await writeText(text);
  await relay(PROTOTYPE_EVENTS.launcherUsed, {
    promptId: prompt.id,
    at: Date.now(),
  });
};

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
  const [variablesFor, setVariablesFor] = useState<Prompt | null>(null);

  useEffect(() => {
    const unlisteners = [
      listen<Library>(PROTOTYPE_EVENTS.librarySync, (event) =>
        setLibrary(event.payload)
      ),
      listen(PROTOTYPE_EVENTS.launcherOpened, () => {
        setVariablesFor(null);
        setOpening((count) => count + 1);
      }),
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

  const copy = async (promptId: PromptId): Promise<LauncherCopyOutcome> => {
    const prompt = library.prompts.find(
      (candidate) => candidate.id === promptId
    );
    if (!prompt) {
      throw new Error("missing-prompt");
    }
    if (extractVariables(prompt.content).length > 0) {
      // Ask here rather than handing off, so close-on-success still holds.
      setVariablesFor(prompt);
      return "stay-open";
    }
    await write(prompt, prompt.content);
    return "copied";
  };

  return (
    <div className="pr0" data-theme="dark" style={{ height: "100vh" }}>
      {variablesFor === null ? (
        <LauncherPanel
          key={opening}
          library={library}
          onClose={close}
          onCopy={copy}
          standalone
        />
      ) : (
        <VariablesDialog
          onCancel={() => setVariablesFor(null)}
          onCopy={(values) => {
            void (async () => {
              await write(
                variablesFor,
                resolveVariables(variablesFor.content, values)
              );
              setVariablesFor(null);
              close();
            })();
          }}
          prompt={variablesFor}
        />
      )}
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
