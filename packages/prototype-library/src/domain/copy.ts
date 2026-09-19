/**
 * PROTOTYPE (issue #9) — copy outcomes and live selection.
 *
 * Issue #7: a prompt use is a *successful* copy. A failed copy records no
 * usage, and the launcher closes only after a successful clipboard write.
 */

import { recordUse } from "./lifecycle";
import type { Library, Prompt, PromptId } from "./types";
import { resolveVariables } from "./variables";

export type ClipboardWriter = (text: string) => Promise<void>;

export type CopyOutcome =
  | { status: "copied"; text: string }
  | { status: "failed"; message: string };

export interface CopyRequest {
  writer: ClipboardWriter;
  library: Library;
  promptId: PromptId;
  now: number;
  variableValues?: Record<string, string>;
}

export interface CopyResult {
  outcome: CopyOutcome;
  /** Unchanged when the write failed. */
  library: Library;
}

export interface LauncherState {
  open: boolean;
  query: string;
  selectedId: PromptId | null;
  error: string | null;
}

/**
 * Preserves the selected prompt by identity while it remains eligible; falls
 * back to the first remaining result, or to nothing when results are empty.
 */
export const resolveSelection = (
  currentId: PromptId | null,
  results: Prompt[]
): PromptId | null => {
  if (currentId !== null && results.some((prompt) => prompt.id === currentId)) {
    return currentId;
  }
  return results[0]?.id ?? null;
};

export const copyPrompt = async (request: CopyRequest): Promise<CopyResult> => {
  const { writer, library, promptId, now, variableValues } = request;
  const prompt = library.prompts.find((candidate) => candidate.id === promptId);

  if (!prompt) {
    return {
      outcome: { status: "failed", message: "missing-prompt" },
      library,
    };
  }

  const text = variableValues
    ? resolveVariables(prompt.content, variableValues)
    : prompt.content;

  try {
    await writer(text);
  } catch (error) {
    return {
      outcome: {
        status: "failed",
        message: error instanceof Error ? error.message : "clipboard-failed",
      },
      library,
    };
  }

  return {
    outcome: { status: "copied", text },
    library: recordUse(library, promptId, now),
  };
};

/** Close-on-success; retain query, selection and an error on failure. */
export const applyCopyToLauncher = (
  state: LauncherState,
  outcome: CopyOutcome
): LauncherState =>
  outcome.status === "copied"
    ? { ...state, open: false, error: null }
    : { ...state, open: true, error: outcome.message };
