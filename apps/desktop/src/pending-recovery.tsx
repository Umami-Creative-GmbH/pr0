import type { UploadStatus } from "@pr0/api-contract/local-prompts";
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
      <h2 id="discard-heading">Discard pending changes to {title}?</h2>
      <p>
        All pending changes to this prompt will be discarded. Copy retained text
        first if you need it. This cannot undo effects already accepted by the
        server. Uncertain delivery must be resolved before discard can finish.
      </p>
      <button ref={cancel} type="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" onClick={onConfirm}>
        Confirm discard
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
          ? "Retry scheduled. Changes remain saved on this device."
          : "Pending changes discarded. Accepted server effects remain in place."
      );
      onChanged();
      await libraryClient.sync();
    } catch (error) {
      if (error === "delivery_uncertain") {
        setMessage(
          "Delivery is uncertain. Nothing was discarded. Retry this change online to resolve its receipt, then review the outcome."
        );
      } else if (error === "accepted_effect_pending_download") {
        setMessage(
          "An effect was already accepted. Nothing was discarded. Finish synchronization before reviewing the remaining changes."
        );
      } else if (error === "recovery_required") {
        setMessage(
          "The server library was restored. Review the pre-recovery library and copy any text you want to preserve into a new prompt. These retained changes cannot be retried automatically."
        );
      } else if (error === "dependent_changes_pending") {
        setMessage(
          "Nothing was discarded. A pending copy depends on this prompt. Sync both changes, or copy and discard the dependent copy first."
        );
      } else {
        setMessage(
          "Nothing was discarded. Check storage and wait for synchronization to finish, then retry."
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
      setMessage("Retained text copied.");
    } catch {
      setMessage(
        "Copy failed. The retained text is still available; retry copying."
      );
    }
  };
  return (
    <details className="space-y-3 rounded border p-3 [&_button]:rounded [&_button]:border [&_button]:px-3 [&_button]:py-2 [&_button:disabled]:opacity-50">
      <summary>Review pending changes ({upload?.waiting ?? 0})</summary>
      <output>{message}</output>
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
                {entry.deleting ? " — deletion pending" : " — changes pending"}
              </p>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={() => {
                  void copy(entry.promptId);
                }}
              >
                Copy retained text
              </button>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={() => {
                  void recover(entry.promptId, "retry");
                }}
              >
                Retry change
              </button>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={() => setSelected(entry)}
              >
                Discard pending changes
              </button>
            </li>
          ))}
      </ul>
      {lastPage > 0 ? (
        <nav
          aria-label="Pending change pages"
          className="flex flex-wrap items-center gap-3"
        >
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous pending changes
          </button>
          <span>
            Page {currentPage + 1} of {lastPage + 1}
          </span>
          <button
            type="button"
            disabled={currentPage === lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            Next pending changes
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
