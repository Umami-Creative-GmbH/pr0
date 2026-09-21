import { useEffect, useRef, useState } from "react";

import { libraryClient } from "./library-client";
import type { Status } from "./use-auth-session";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- IPC errors are untrusted; display only fixed messages.
export const copyError = (error: unknown) => {
  if (error === "clipboard_busy") {
    return "Another copy is in progress. Wait for it to finish, then try again.";
  }
  if (error === "operation_cancelled") {
    return "The account changed. Select the prompt again before copying.";
  }
  if (error === "prompt_unavailable") {
    return "This prompt is no longer available. Refresh the library.";
  }
  if (error instanceof Error && error.message === "copy_uncertain") {
    return "Copy could not be confirmed. Check the clipboard before copying again.";
  }
  return "Could not copy. Your prompt is preserved. Try Copy again.";
};

export const usePromptCopy = (account: Status, refresh: () => void) => {
  const active = useRef(true);
  const writing = useRef<{ generation: number } | null>(null);
  const [copyState, setCopyState] = useState({
    generation: account.generation,
    busy: false,
    message: "",
  });
  const busy = copyState.generation === account.generation && copyState.busy;
  const message =
    copyState.generation === account.generation ? copyState.message : "";
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (message !== "Copied.") {
      return;
    }
    const timer = setTimeout(
      () => setCopyState((current) => ({ ...current, message: "" })),
      3000
    );
    return () => clearTimeout(timer);
  }, [message]);
  const handleCopy = async (promptId: string) => {
    if (
      writing.current?.generation === account.generation ||
      !account.instanceId ||
      !account.accountId
    ) {
      return;
    }
    const attempt = { generation: account.generation };
    writing.current = attempt;
    setCopyState({ ...attempt, busy: true, message: "" });
    try {
      const result = await libraryClient.copy({
        instanceId: account.instanceId,
        accountId: account.accountId,
        generation: account.generation,
        promptId,
      });
      if (active.current && writing.current === attempt) {
        setCopyState({
          ...attempt,
          busy: false,
          message: result.usageSaved
            ? "Copied."
            : "Copied. Usage could not be saved. Retry usage without copying again; this retry may be lost if the app closes.",
        });
        refresh();
      }
    } catch (error) {
      if (active.current && writing.current === attempt) {
        setCopyState({ ...attempt, busy: false, message: copyError(error) });
      }
    }
    if (writing.current === attempt) {
      writing.current = null;
    }
  };
  return {
    busy,
    message,
    handleCopy,
    usageRetried: () =>
      setCopyState({
        generation: account.generation,
        busy: false,
        message: "Usage saved. The clipboard was not written again.",
      }),
  };
};
