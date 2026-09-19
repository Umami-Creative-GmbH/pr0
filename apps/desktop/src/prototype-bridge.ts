/**
 * PROTOTYPE (issue #9) — the event contract between the main window and the
 * native launcher window.
 *
 * The main window owns the library; the launcher mirrors it. Both windows
 * import these names so the two ends cannot drift apart.
 */

import type { Library } from "@pr0/prototype-library/domain/types";
import { invoke } from "@tauri-apps/api/core";

export const PROTOTYPE_EVENTS = {
  /** Main -> launcher: the current library. */
  librarySync: "library:sync",
  /** Launcher -> main: send me the library, I have just been shown. */
  libraryRequest: "launcher:request-library",
  /** Launcher -> main: this prompt was successfully copied. */
  launcherUsed: "launcher:used",
  /** Rust -> launcher: the window was shown, reset query and filters. */
  launcherOpened: "launcher:opened",
} as const;

export interface LauncherUsedPayload {
  promptId: string;
  at: number;
}

export type RelayPayload = Library | LauncherUsedPayload | null;

/** Rust re-emits the event to both windows. */
export const relay = (event: string, payload: RelayPayload = null) =>
  invoke("relay", { event, payload });
