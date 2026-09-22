"use client";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { useTranslations } from "../hooks/use-translations";

export const WayfinderDialog = ({
  children,
  label,
  onRequestClose,
  opener,
  suspended = false,
  size,
}: {
  children: ReactNode;
  label: string;
  onRequestClose: () => void;
  opener?: Element | null;
  suspended?: boolean;
  size?: "sm" | "launcher";
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const returnTo = opener ?? document.activeElement;
    const dialog = ref.current;
    if (!suspended) {
      dialog?.showModal();
    }
    return () => {
      dialog?.close();
      if (returnTo instanceof HTMLElement && returnTo.isConnected) {
        returnTo.focus();
      }
    };
  }, [opener, suspended]);
  return (
    <dialog
      ref={ref}
      hidden={suspended}
      className="wf-dialog"
      data-size={size}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onRequestClose();
      }}
    >
      {children}
    </dialog>
  );
};

export const DialogHead = ({
  eyebrow,
  title,
  titleId,
  onClose,
  closeLabel,
  closeDisabled,
}: {
  eyebrow: string;
  title: ReactNode;
  titleId?: string;
  onClose?: () => void;
  closeLabel?: string;
  closeDisabled?: boolean;
}) => {
  const t = useTranslations();
  return (
    <header className="wf-dialog-head">
      <div>
        <span className="wf-eyebrow-accent">{eyebrow}</span>
        <h2 id={titleId}>{title}</h2>
      </div>
      {onClose ? (
        <button
          type="button"
          className="wf-icon-btn"
          data-size="md"
          aria-label={closeLabel ?? t("close")}
          disabled={closeDisabled}
          onClick={onClose}
        >
          <X aria-hidden="true" size={15} />
        </button>
      ) : null}
    </header>
  );
};
