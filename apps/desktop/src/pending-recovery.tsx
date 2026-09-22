import type { UploadStatus } from "@pr0/api-contract/local-prompts";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useEffect, useRef, useState } from "react";

import { libraryClient } from "./library-client";
import type { Status } from "./use-auth-session";

const DiscardDialog = ({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const t = useTranslations();

  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="discard-heading"
      className="bg-background text-foreground m-auto max-w-lg rounded border p-6 backdrop:bg-black/50"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="discard-heading">
        {t("discardPendingChangesTo")} {title}?
      </h2>
      <p>{t("allPendingChangesToThisPromptWillBeDiscardedCopy")}</p>
      <button ref={cancel} type="button" onClick={onCancel}>
        {t("cancel")}
      </button>
      <button type="button" onClick={onConfirm}>
        {t("confirmDiscard")}
      </button>
    </dialog>
  );
};
export const PendingRecovery = ({
  account,
  upload,
  onChanged,
  disabled,
}: {
  account: Status;
  upload?: UploadStatus;
  onChanged: () => void;
  disabled: boolean;
}) => {
  const t = useTranslations();

  const [selected, setSelected] = useState<UploadStatus["pending"][number]>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const entries = upload?.pending ?? [];
  const lastPage = Math.max(0, Math.ceil(entries.length / 50) - 1);
  const currentPage = Math.min(page, lastPage);
  const recover = async (promptId: string, action: "retry" | "discard") => {
    if (busy || !account.instanceId || !account.accountId) {
      return;
    }
    setBusy(true);
    try {
      await libraryClient.recover({
        instanceId: account.instanceId,
        accountId: account.accountId,
        generation: account.generation,
        promptId,
        action,
        confirmed: action === "discard",
      });
      setMessage(
        action === "retry"
          ? t("retryScheduledChangesRemainSavedOnThisDevice")
          : t("pendingChangesDiscardedAcceptedServerEffectsRemainInPlace")
      );
      onChanged();
      await libraryClient.sync();
    } catch (error) {
      if (error === "delivery_uncertain") {
        setMessage(
          t("deliveryIsUncertainNothingWasDiscardedRetryThisChangeOnline")
        );
      } else if (error === "accepted_effect_pending_download") {
        setMessage(
          t(
            "anEffectWasAlreadyAcceptedNothingWasDiscardedFinishSynchronization"
          )
        );
      } else if (error === "recovery_required") {
        setMessage(t("theServerLibraryWasRestoredReviewThePreRecoveryLibrary"));
      } else if (error === "dependent_changes_pending") {
        setMessage(t("nothingWasDiscardedAPendingCopyDependsOnThisPrompt"));
      } else {
        setMessage(
          t("nothingWasDiscardedCheckStorageAndWaitForSynchronizationTo")
        );
      }
    }
    setBusy(false);
  };
  const copy = async (id: string) => {
    if (!account.instanceId || !account.accountId) {
      return;
    }
    try {
      const prompt = await libraryClient.retained(id);
      await libraryClient.copyDraft({
        instanceId: account.instanceId,
        accountId: account.accountId,
        generation: account.generation,
        operationId: crypto.randomUUID(),
        promptId: id,
        expectedLocalRevision: null,
        desired: prompt,
      });
      setMessage(t("retainedTextCopied"));
    } catch {
      setMessage(t("copyFailedTheRetainedTextIsStillAvailableRetryCopying"));
    }
  };
  return (
    <details className="space-y-3 rounded border p-3 [&_button]:rounded [&_button]:border [&_button]:px-3 [&_button]:py-2 [&_button:disabled]:opacity-50">
      <summary>
        {t("reviewPendingChanges")}
        {upload?.waiting ?? 0})
      </summary>
      <output>
        <LocalizedMessage value={message} />
      </output>
      <ul className="space-y-3">
        {entries
          .slice(currentPage * 50, (currentPage + 1) * 50)
          .map((entry) => (
            <li
              key={entry.promptId}
              className="flex flex-wrap gap-2 rounded border p-3"
            >
              <p className="w-full break-words">
                {entry.title}
                {entry.deleting ? t("deletionPending2") : t("changesPending")}
              </p>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={() => {
                  void copy(entry.promptId);
                }}
              >
                {t("copyRetainedText")}
              </button>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={() => {
                  void recover(entry.promptId, "retry");
                }}
              >
                {t("retryChange")}
              </button>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={() => setSelected(entry)}
              >
                {t("discardPendingChanges")}
              </button>
            </li>
          ))}
      </ul>
      {lastPage > 0 ? (
        <nav
          aria-label={t("pendingChangePages")}
          className="flex flex-wrap items-center gap-3"
        >
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t("previousPendingChanges")}
          </button>
          <span>
            {t("page")} {currentPage + 1} {t("of")} {lastPage + 1}
          </span>
          <button
            type="button"
            disabled={currentPage === lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            {t("nextPendingChanges")}
          </button>
        </nav>
      ) : null}
      {selected ? (
        <DiscardDialog
          title={selected.title}
          onCancel={() => setSelected(undefined)}
          onConfirm={() => {
            void recover(selected.promptId, "discard");
            setSelected(undefined);
          }}
        />
      ) : null}
    </details>
  );
};
