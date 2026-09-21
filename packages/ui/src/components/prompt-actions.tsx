"use client";

import { Copy, MoreHorizontal, Star } from "lucide-react";
import type { ReactNode } from "react";

import { useDismissable } from "../hooks/use-dismissable";

export const PromptIconAction = ({
  label,
  kind,
  active,
  disabled,
  onClick,
  size,
}: {
  label: string;
  kind: "copy" | "favorite";
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  size?: "sm";
}) => (
  <button
    type="button"
    className="wf-icon-btn"
    data-size={size}
    aria-label={label}
    data-prompt-action={kind}
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
  >
    {kind === "copy" ? (
      <Copy aria-hidden="true" size={size ? 14 : 16} />
    ) : (
      <Star
        aria-hidden="true"
        size={size ? 14 : 16}
        fill={active ? "currentColor" : "none"}
      />
    )}
  </button>
);

export const PromptMoreActions = ({
  label,
  children,
  size,
}: {
  label: string;
  children: ReactNode;
  size?: "sm";
}) => {
  const ref = useDismissable();
  return (
    <details className="wf-more" ref={ref}>
      <summary aria-label={label} className="wf-icon-btn" data-size={size}>
        <MoreHorizontal aria-hidden="true" size={size ? 14 : 16} />
      </summary>
      <div>{children}</div>
    </details>
  );
};
