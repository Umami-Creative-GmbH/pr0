/**
 * PROTOTYPE (issue #9) — modal overlay.
 *
 * Uses the native `<dialog>` so focus trapping, the backdrop and Escape come
 * from the platform rather than from hand-rolled handlers.
 */

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export interface OverlayProps {
  children: ReactNode;
  onClose: () => void;
  align?: "top" | "center";
  /** Accessible name for the dialog. */
  label: string;
}

export const Overlay = ({
  children,
  onClose,
  align = "center",
  label,
}: OverlayProps) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      aria-label={label}
      className="pr0-scrim"
      data-align={align}
      onCancel={(event) => {
        // Escape is handled globally so every overlay closes the same way.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click that lands on the dialog element itself is on the backdrop;
        // clicks inside the content hit a descendant.
        if (event.target === ref.current) {
          onClose();
        }
      }}
      ref={ref}
    >
      <div className="pr0-scrim-content">{children}</div>
    </dialog>
  );
};
