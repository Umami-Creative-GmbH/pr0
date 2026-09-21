"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export const WayfinderDialog = ({
  children,
  label,
  onRequestClose,
  opener,
  suspended = false,
}: {
  children: ReactNode;
  label: string;
  onRequestClose: () => void;
  opener?: Element | null;
  suspended?: boolean;
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
