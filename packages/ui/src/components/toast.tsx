"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const dismissAfterMs = 2200;

const ToastBody = ({
  transient,
  children,
}: {
  transient: boolean;
  children: ReactNode;
}) => {
  const [dismissed, setDismissed] = useState(false);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!transient || held || dismissed) {
      return;
    }
    const timer = setTimeout(() => setDismissed(true), dismissAfterMs);
    return () => clearTimeout(timer);
  }, [transient, held, dismissed]);
  return (
    <div
      className={transient && dismissed ? "sr-only" : "wf-toast"}
      onBlur={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
    >
      {children}
    </div>
  );
};

/**
 * Feedback in the corner of the window. Plain success (`transient`) leaves the
 * screen after a moment unless the pointer or focus is on it; its text stays
 * available to assistive technology. Anything with failure text or recovery
 * controls is not transient and stays until acted on.
 */
export const Toast = ({
  transient,
  signal,
  children,
}: {
  transient: boolean;
  /** Changes whenever new feedback arrives, which shows it afresh. */
  signal: string;
  children: ReactNode;
}) => (
  <ToastBody key={signal} transient={transient}>
    {children}
  </ToastBody>
);
