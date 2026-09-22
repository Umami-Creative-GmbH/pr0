import type {
  LifecycleAction,
  LocalLifecycle,
  LocalPrompt,
} from "@pr0/api-contract/local-prompts";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import type { MessageKey } from "@pr0/ui/lib/i18n";
import { useRef, useState } from "react";
import { z } from "zod";

import { libraryClient } from "./library-client";
import type { Status } from "./use-auth-session";

const errorKeys = new Map<string, MessageKey>([
  ["quota_exceeded", "capacityReachedFreeCapacityAndRetryArchivingDoesNotFree"],
  [
    "local_revision_conflict",
    "theSavedPromptChangedYourChosenActionWasNotSaved",
  ],
  ["disk_full", "thisDeviceIsOutOfStorageSpaceFreeSpaceAnd2"],
  ["storage_busy", "anotherWriteIsUsingTheLibraryRetryShortly"],
  ["commit_uncertain", "theResultCouldNotBeConfirmedRetryToCheckThis"],
]);
export const useLifecycle = (
  account: Status,
  onSaved: (id: string | null, action: LifecycleAction) => void
) => {
  const t = useTranslations();

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
          ? t("savedOnThisDeviceDeletionIsWaitingToSync")
          : t("savedOnThisDeviceChangesWaitingToSync2")
      );
      onSaved(
        request.action.kind === "delete" ? null : result.promptId,
        request.action
      );
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
          ? t("theResultCouldNotBeConfirmedRetryToCheckThis")
          : t("notSavedValue", [
              t(
                errorKeys.get(code) ??
                  "checkStorageAccessAndRetryTheChosenActionAndSource"
              ),
            ])
      );
    }
    active.current = false;
    setBusy(false);
  };
  const handleAction = (source: LocalPrompt, action: LifecycleAction) => {
    if (uncertain.current) {
      setMessage(
        t("resolveTheUnconfirmedActionWithRetryActionBeforeChoosingAnother")
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
      setMessage(t("textCopiedTheActionStillNeedsAttention"));
    } catch {
      setMessage(t("copyFailedRetryCopyingYourChosenSourceTextIsRetained"));
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
      setMessage(t("thisPromptChangedOpenItAndRetryTheAction"));
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
