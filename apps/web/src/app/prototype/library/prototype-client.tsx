"use client";

/** PROTOTYPE (issue #9) — client-only, so relative dates never hydrate-mismatch. */

import type { ClipboardWriter } from "@pr0/prototype-library/domain/copy";
import { createSeedLibrary } from "@pr0/prototype-library/domain/seed";
import type { Library } from "@pr0/prototype-library/domain/types";
import { PrototypeShell } from "@pr0/prototype-library/ui/prototype-shell";
import { useMemo, useState } from "react";

import "@pr0/prototype-library/prototype.css";

// Captured once at load so relative dates do not drift during a session.
const SESSION_NOW = Date.now();

const PrototypeClient = () => {
  const [library, setLibrary] = useState<Library>(() =>
    createSeedLibrary(SESSION_NOW)
  );
  const [clipboardFails, setClipboardFails] = useState(false);

  const clipboard: ClipboardWriter = useMemo(
    () => async (text: string) => {
      if (clipboardFails) {
        throw new Error("clipboard blocked (prototype tool)");
      }
      if (!navigator.clipboard) {
        throw new Error("clipboard unavailable in this browser");
      }
      await navigator.clipboard.writeText(text);
    },
    [clipboardFails]
  );

  return (
    <PrototypeShell
      clipboard={clipboard}
      clipboardFails={clipboardFails}
      initialSurface="web"
      library={library}
      now={SESSION_NOW}
      onClipboardFailureChange={setClipboardFails}
      onLibraryChange={setLibrary}
    />
  );
};

export default PrototypeClient;
