"use client";

import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type {
  MutationEnvelope,
  MutationReceipt,
  Prompt,
  PromptText,
} from "@pr0/api-contract/prompts";
import { useEffect, useRef, useState } from "react";

export type PromptAction = "favorite" | "archived" | "duplicate" | "delete";
export const usePromptActions = ({
  library,
  onAccepted,
  onDirtyChange,
}: {
  library: PrivateLibrary;
  onAccepted: (
    receipt: MutationReceipt,
    action: PromptAction,
    message: string
  ) => void;
  onDirtyChange: (dirty: boolean) => void;
}) => {
  const client = useApiClient();
  const pending = useRef<{
    envelope: MutationEnvelope;
    action: PromptAction;
    message: string;
  } | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [knownRejected, setKnownRejected] = useState(false);
  const [retainedText, setRetainedText] = useState<PromptText | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  useEffect(() => {
    if (!busy && !actionError) {
      return;
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [busy, actionError]);
  const send = async () => {
    const request = pending.current;
    if (!request) {
      return;
    }
    setActionError("");
    setKnownRejected(false);
    try {
      const response = await client.mutatePrompts(
        request.envelope,
        AbortSignal.timeout(30_000)
      );
      const [result] = response.results;
      if (result?.status === "accepted" && "promptId" in result) {
        pending.current = null;
        setCanRetry(false);
        setRetainedText(null);
        onDirtyChange(false);
        onAccepted(result, request.action, request.message);
      } else if (result?.status === "rejected") {
        setActionError(result.error.message);
        setKnownRejected(
          [
            "validation_failed",
            "quota_exceeded",
            "dependency_blocked",
            "identity_unavailable",
            "not_found",
          ].includes(result.error.code)
        );
      }
    } catch (error) {
      setActionError(
        error instanceof PromptApiError
          ? error.message
          : "The server did not confirm this action. Retry to confirm its outcome."
      );
    }
  };
  const act = async (
    target: { id: string; revision: string } | Prompt,
    action: PromptAction,
    value?: boolean
  ) => {
    if (inFlight.current || pending.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setActionError("");
    setCopyMessage("");
    onDirtyChange(true);
    try {
      let operation: MutationEnvelope["operations"][number];
      let retained: PromptText | null = null;
      if (action === "delete") {
        operation = {
          kind: "prompt.delete",
          operationId: crypto.randomUUID(),
          promptId: target.id,
          baseRevision: target.revision,
          dependsOn: [],
        };
      } else {
        const source =
          "content" in target
            ? target
            : await client.getPrompt(target.id, AbortSignal.timeout(30_000), {
                instanceId: library.instance.id,
                accountId: library.account.id,
              });
        const text = {
          title: source.title,
          description: source.description,
          content: source.content,
        };
        const common = {
          operationId: crypto.randomUUID(),
          promptId: source.id,
          baseRevision: source.revision,
          dependsOn: [],
        };
        operation =
          action === "duplicate"
            ? {
                ...common,
                kind: "prompt.duplicate",
                promptId: crypto.randomUUID(),
                sourceId: source.id,
                desired: { ...text, collectionId: source.collectionId },
              }
            : {
                ...common,
                kind: "prompt.update",
                base: { ...text, [action]: source[action] },
                desired: { ...text, [action]: value },
                changedFields: source[action] === value ? [] : [action],
              };
        retained = action === "duplicate" ? text : null;
      }
      const messages = {
        favorite: "Favorite updated.",
        archived: value ? "Prompt archived." : "Prompt restored.",
        duplicate: "Prompt duplicated.",
        delete: "Prompt permanently deleted.",
      };
      pending.current = {
        envelope: {
          protocolVersion: 1,
          instanceId: library.instance.id,
          accountId: library.account.id,
          epoch: library.epoch,
          installationId: crypto.randomUUID(),
          operations: [operation],
        },
        action,
        message: messages[action],
      };
      setRetainedText(retained);
      setCanRetry(true);
      await send();
    } catch (error) {
      setActionError(
        error instanceof PromptApiError
          ? error.message
          : "Could not load the selected prompt. Dismiss and try the action again."
      );
      setKnownRejected(true);
    }
    inFlight.current = false;
    setBusy(false);
  };
  const retry = async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    await send();
    inFlight.current = false;
    setBusy(false);
  };
  const dismiss = () => {
    if (!knownRejected || inFlight.current) {
      return;
    }
    pending.current = null;
    setCanRetry(false);
    setActionError("");
    setRetainedText(null);
    onDirtyChange(false);
  };
  const copy = async () => {
    if (!retainedText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(retainedText.content);
      setCopyMessage("Copied text.");
    } catch {
      setCopyMessage(
        "Could not copy text. Select the retained text and copy it manually, or retry."
      );
    }
  };
  return {
    act,
    retry,
    dismiss,
    copy,
    busy,
    blocked: busy || Boolean(actionError),
    error: actionError,
    knownRejected,
    retainedText,
    copyMessage,
    canRetry,
  };
};
