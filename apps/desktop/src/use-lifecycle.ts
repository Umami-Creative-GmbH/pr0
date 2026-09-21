import type {
  LifecycleAction,
  LocalLifecycle,
  LocalPrompt,
} from "@pr0/api-contract/local-prompts";
import { useRef, useState } from "react";
import { z } from "zod";

import { libraryClient } from "./library-client";
import type { Status } from "./use-auth-session";

const errors = new Map([
  [
    "quota_exceeded",
    "Capacity reached. Free capacity and retry. Archiving does not free capacity.",
  ],
  [
    "local_revision_conflict",
    "The saved prompt changed. Your chosen action was not saved. Copy its text or review the current prompt before choosing the action again.",
  ],
  ["disk_full", "This device is out of storage space. Free space and retry."],
  ["storage_busy", "Another write is using the library. Retry shortly."],
  [
    "commit_uncertain",
    "The result could not be confirmed. Retry to check this same action safely.",
  ],
]);
export const useLifecycle = (
  account: Status,
  onSaved: (id: string | null) => void
) => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const attempt = useRef<{
    request: LocalLifecycle;
    source: LocalPrompt;
  } | null>(null);
  const active = useRef(false);
  const uncertain = useRef(false);
  const execute = async () => {
    if (active.current || !attempt.current) {
      return;
    }
    active.current = true;
    setBusy(true);
    const request = {
      ...attempt.current.request,
      generation: account.generation,
    };
    try {
      const result = await libraryClient.lifecycle(request);
      attempt.current = null;
      uncertain.current = false;
      setFailed(false);
      setMessage(
        request.action.kind === "delete"
          ? "Saved on this device. Deletion is waiting to sync."
          : "Saved on this device. Changes waiting to sync."
      );
      onSaved(request.action.kind === "delete" ? null : result.promptId);
    } catch (error) {
      setFailed(true);
      const parsed = z.string().safeParse(error);
      const code = parsed.success ? parsed.data : "commit_uncertain";
      uncertain.current = ![
        "quota_exceeded",
        "local_revision_conflict",
        "disk_full",
        "storage_busy",
        "storage_unavailable",
        "invalid_input",
        "confirmation_required",
        "operation_identity_reused",
      ].includes(code);
      setMessage(
        uncertain.current
          ? "The result could not be confirmed. Retry to check this same action safely."
          : `Not saved. ${errors.get(code) ?? "Check storage access and retry. The chosen action and source text remain available here."}`
      );
    }
    active.current = false;
    setBusy(false);
  };
  const handleAction = (source: LocalPrompt, action: LifecycleAction) => {
    if (uncertain.current) {
      setMessage(
        "Resolve the unconfirmed action with Retry action before choosing another action. Your source text is retained."
      );
      return;
    }
    if (active.current || !account.instanceId || !account.accountId) {
      return;
    }
    attempt.current = {
      source,
      request: {
        instanceId: account.instanceId,
        accountId: account.accountId,
        generation: account.generation,
        operationId: crypto.randomUUID(),
        promptId: source.prompt.id,
        expectedLocalRevision: source.localRevision,
        action,
      },
    };
    void execute();
  };
  const copy = async () => {
    if (!attempt.current) {
      return;
    }
    try {
      await libraryClient.copyDraft({
        ...attempt.current.request,
        desired: attempt.current.source.prompt,
      });
      setMessage("Text copied. The action still needs attention.");
    } catch {
      setMessage(
        "Copy failed. Retry copying; your chosen source text is retained."
      );
    }
  };
  const handleFavorite = async (id: string) => {
    try {
      const source = await libraryClient.editor(id);
      handleAction(source, {
        kind: "favorite",
        value: !source.prompt.favorite,
      });
    } catch {
      setMessage("This prompt changed. Open it and retry the action.");
    }
  };
  return {
    handleAction,
    handleFavorite,
    busy,
    failed,
    message,
    retry: execute,
    copy,
  };
};
