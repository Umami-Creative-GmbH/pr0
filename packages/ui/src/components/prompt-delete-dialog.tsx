"use client";

import { useEffect, useRef } from "react";

const buttonClass = "wf-btn";
export const PromptDeleteDialog = ({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-prompt-heading"
      aria-describedby="delete-prompt-warning"
      className="bg-background text-foreground m-auto max-h-[90dvh] w-[min(32rem,90vw)] overflow-y-auto rounded-lg border p-6 backdrop:bg-black/50"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="delete-prompt-heading" className="text-xl font-semibold">
        Permanently delete prompt?
      </h2>
      <p className="my-3 break-words">{title}</p>
      <p id="delete-prompt-warning">
        This permanently removes this prompt. There is no trash or restore.
        Unseen edits from another device are preserved in an independent
        conflict copy.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          ref={cancelRef}
          className={buttonClass}
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className={`${buttonClass} border-destructive text-destructive`}
          type="button"
          onClick={onConfirm}
        >
          Permanently delete
        </button>
      </div>
    </dialog>
  );
};
