"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export const WayfinderDialog = ({
  children,
  label,
  onRequestClose,
  opener,
}: {
  children: ReactNode;
  label: string;
  onRequestClose: () => void;
  opener?: Element | null;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const returnTo = opener ?? document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (returnTo instanceof HTMLElement && returnTo.isConnected) {
        returnTo.focus();
      }
    };
  }, [opener]);
  return (
    <dialog
      ref={ref}
      className="wf-dialog"
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
