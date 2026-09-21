"use client";

import { Copy, MoreHorizontal, Star } from "lucide-react";
import type { ReactNode } from "react";

export const PromptIconAction = ({
  label,
  kind,
  active,
  disabled,
  onClick,
}: {
  label: string;
  kind: "copy" | "favorite";
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className="wf-icon-action"
    aria-label={label}
    data-prompt-action={kind}
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
  >
    {kind === "copy" ? (
      <Copy aria-hidden="true" size={15} />
    ) : (
      <Star
        aria-hidden="true"
        size={15}
        fill={active ? "currentColor" : "none"}
      />
    )}
  </button>
);

export const PromptMoreActions = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <details className="wf-more-actions">
    <summary aria-label={label}>
      <MoreHorizontal aria-hidden="true" size={16} />
    </summary>
    <div>{children}</div>
  </details>
);
