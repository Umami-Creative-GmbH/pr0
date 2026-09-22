"use client";

import type { ReactNode } from "react";
import { useId } from "react";

import { usePresentationTime } from "../hooks/use-presentation-time";
import { useLocale } from "../hooks/use-translations";
import type { Accent } from "../lib/present";
import { relativeTime } from "../lib/present";

export const RelativeTime = ({ at }: { at: string }) => {
  const locale = useLocale();
  const now = usePresentationTime();
  return (
    <time dateTime={at} title={new Date(at).toLocaleString(locale)}>
      {relativeTime(at, now, locale)}
    </time>
  );
};

/**
 * One library result. The row button keeps its accessible name to the title
 * and preview; organization and age are supporting text.
 */
export const PromptRow = ({
  title,
  label,
  suffix,
  preview,
  collection,
  accent,
  tags,
  modifiedAt,
  selected,
  disabled,
  onSelect,
  children,
}: {
  title: string;
  /** Overrides the accessible name, which otherwise is the title and preview. */
  label?: string;
  suffix?: string;
  preview?: string;
  collection?: string;
  accent?: Accent;
  tags?: string[];
  modifiedAt?: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** Row actions: favorite, copy and the overflow menu. */
  children?: ReactNode;
}) => {
  const id = useId();
  const labelledBy = preview ? `${id}-title ${id}-preview` : `${id}-title`;
  const hasMeta = Boolean(collection || tags?.length || modifiedAt);
  return (
    <li className="wf-row">
      <button
        data-prompt-row
        aria-pressed={selected}
        aria-label={label}
        aria-labelledby={label ? undefined : labelledBy}
        className="wf-row-main"
        disabled={disabled}
        onClick={onSelect}
        type="button"
      >
        <span className="wf-row-title" id={`${id}-title`}>
          {title}
          {suffix}
        </span>
        {preview ? (
          <span className="wf-row-preview" id={`${id}-preview`}>
            {preview}
          </span>
        ) : null}
        {hasMeta ? (
          <span className="wf-row-meta">
            {collection ? (
              <span>
                <span className="wf-dot" data-accent={accent} />
                {collection}
              </span>
            ) : null}
            {tags?.length ? (
              <span className="wf-mono">
                {tags.map((tag) => `#${tag}`).join(" ")}
              </span>
            ) : null}
            {modifiedAt ? <RelativeTime at={modifiedAt} /> : null}
          </span>
        ) : null}
      </button>
      {children ? <div className="wf-row-actions">{children}</div> : null}
    </li>
  );
};
