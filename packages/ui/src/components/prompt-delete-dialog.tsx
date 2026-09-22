"use client";
import { useEffect, useRef } from "react";

import { useTranslations } from "../hooks/use-translations";

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
  const t = useTranslations();

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
        {t("permanentlyDeletePrompt2")}
      </h2>
      <p className="my-3 break-words">{title}</p>
      <p id="delete-prompt-warning">
        {t("thisPermanentlyRemovesThisPromptThereIsNoTrashOr")}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          ref={cancelRef}
          className={buttonClass}
          type="button"
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
        <button
          className={`${buttonClass} border-destructive text-destructive`}
          type="button"
          onClick={onConfirm}
        >
          {t("permanentlyDelete")}
        </button>
      </div>
    </dialog>
  );
};
