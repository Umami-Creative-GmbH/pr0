/**
 * PROTOTYPE (issue #9) — copy outcomes for the library surface.
 *
 * Issue #7: a use is a *successful* copy. Failures record nothing, confirm
 * nothing, and offer a retry.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ClipboardWriter } from "../domain/copy";
import { copyPrompt } from "../domain/copy";
import type { Library, Prompt, PromptId } from "../domain/types";
import { extractVariables } from "../domain/variables";
import type { Toast } from "./prototype-toast";

const TOAST_MS = 2600;

export interface UseLibraryCopyOptions {
  library: Library;
  onLibraryChange: (next: Library) => void;
  clipboard: ClipboardWriter;
  copiedLabel: string;
  failedLabel: string;
}

export interface LibraryCopy {
  toast: Toast | null;
  showToast: (toast: Toast) => void;
  /** Opens the value dialog first when the prompt has variables. */
  requestCopy: (prompt: Prompt | null) => void;
  copyResolved: (
    prompt: Prompt,
    variableValues?: Record<string, string>
  ) => Promise<void>;
  /** Rejects on failure so the launcher can stay open and offer a retry. */
  copyFromLauncher: (promptId: PromptId) => Promise<void>;
  variablesFor: Prompt | null;
  setVariablesFor: (prompt: Prompt | null) => void;
}

export const useLibraryCopy = ({
  library,
  onLibraryChange,
  clipboard,
  copiedLabel,
  failedLabel,
}: UseLibraryCopyOptions): LibraryCopy => {
  const [toast, setToast] = useState<Toast | null>(null);
  const [variablesFor, setVariablesFor] = useState<Prompt | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: Toast) => {
    if (toastTimer.current !== null) {
      clearTimeout(toastTimer.current);
    }
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) {
        clearTimeout(toastTimer.current);
      }
    },
    []
  );

  /** Writes to the clipboard, recording use only on success. */
  const runCopy = useCallback(
    async (
      promptId: PromptId,
      variableValues?: Record<string, string>
    ): Promise<void> => {
      const result = await copyPrompt({
        writer: clipboard,
        library,
        promptId,
        now: Date.now(),
        variableValues,
      });

      if (result.outcome.status === "failed") {
        throw new Error(result.outcome.message);
      }
      onLibraryChange(result.library);
    },
    [clipboard, library, onLibraryChange]
  );

  // The retry action re-enters this function, so it goes through a ref rather
  // than referring to the callback while it is still being initialised.
  const copyResolvedRef = useRef<
    (prompt: Prompt, variableValues?: Record<string, string>) => Promise<void>
  >(() => Promise.resolve());

  const copyResolved = useCallback(
    async (prompt: Prompt, variableValues?: Record<string, string>) => {
      try {
        await runCopy(prompt.id, variableValues);
        showToast({
          tone: "success",
          label: copiedLabel,
          detail: prompt.title,
        });
      } catch (error) {
        showToast({
          tone: "error",
          label: failedLabel,
          detail: error instanceof Error ? error.message : "",
          onRetry: () => {
            void copyResolvedRef.current(prompt, variableValues);
          },
        });
      }
    },
    [runCopy, showToast, copiedLabel, failedLabel]
  );

  useEffect(() => {
    copyResolvedRef.current = copyResolved;
  }, [copyResolved]);

  const requestCopy = useCallback(
    (prompt: Prompt | null) => {
      if (prompt === null) {
        return;
      }
      if (extractVariables(prompt.content).length > 0) {
        setVariablesFor(prompt);
        return;
      }
      void copyResolved(prompt);
    },
    [copyResolved]
  );

  /**
   * OPEN QUESTION for issue #9: a prompt with variables cannot be copied
   * without asking for values, so the launcher hands off to the value dialog
   * and closes before any clipboard write. That follows the design but bends
   * issue #7's "closes only after a successful clipboard write". Confirm with
   * the human whether the value dialog should instead live inside the
   * launcher so the rule holds literally.
   */
  const copyFromLauncher = useCallback(
    async (promptId: PromptId) => {
      const prompt = library.prompts.find(
        (candidate) => candidate.id === promptId
      );
      if (!prompt) {
        throw new Error("missing-prompt");
      }
      if (extractVariables(prompt.content).length > 0) {
        setVariablesFor(prompt);
        return;
      }
      await runCopy(promptId);
      showToast({ tone: "success", label: copiedLabel, detail: prompt.title });
    },
    [library, runCopy, showToast, copiedLabel]
  );

  return {
    toast,
    showToast,
    requestCopy,
    copyResolved,
    copyFromLauncher,
    variablesFor,
    setVariablesFor,
  };
};
