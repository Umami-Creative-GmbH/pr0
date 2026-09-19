/** PROTOTYPE (issue #9) — selected prompt, its actions and its content. */

import { useTranslate } from "@tolgee/react";
import {
  Archive,
  ArchiveRestore,
  Command,
  Copy,
  Ellipsis,
  FileText,
  Pencil,
  Star,
  Trash,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Library, Prompt, PromptId } from "../domain/types";
import { extractVariables, splitContent } from "../domain/variables";
import { formatDate, formatRelative } from "./formatting";

export interface PromptDetailProps {
  library: Library;
  prompt: Prompt | null;
  locale: string;
  now: number;
  onCopy: () => void;
  onEdit: () => void;
  onToggleFavorite: () => void;
  onDuplicate: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

export const PromptDetail = ({
  library,
  prompt,
  locale,
  now,
  onCopy,
  onEdit,
  onToggleFavorite,
  onDuplicate,
  onToggleArchive,
  onDelete,
}: PromptDetailProps) => {
  const { t } = useTranslate();
  // Storing the owning prompt id means switching prompts closes the menu
  // during render, with no reset-after-the-fact effect.
  const [menuFor, setMenuFor] = useState<PromptId | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = menuFor !== null && menuFor === prompt?.id;
  const setMenuOpen = (open: boolean) =>
    setMenuFor(open ? (prompt?.id ?? null) : null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const close = (event: MouseEvent) => {
      // SAFETY: a DOM mousedown target is always a Node.
      const target = event.target as Node;
      if (!menuRef.current?.contains(target)) {
        setMenuFor(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  if (prompt === null) {
    return (
      <div className="pr0-detail">
        <div
          className="pr0-empty"
          style={{ flex: 1, justifyContent: "center" }}
        >
          <Command aria-hidden="true" size={30} />
          <h3 style={{ fontSize: 18 }}>{t("detail.none.title")}</h3>
          <p style={{ maxWidth: 320, fontSize: 13.5 }}>
            {t("detail.none.body")}
          </p>
        </div>
      </div>
    );
  }

  const collection = library.collections.find(
    (candidate) => candidate.id === prompt.collectionId
  );
  const variables = extractVariables(prompt.content);

  return (
    <div className="pr0-detail">
      <div className="pr0-detail-head">
        <div className="pr0-detail-eyebrow">
          <span
            className="pr0-dot"
            style={{
              background: collection?.accent ?? "var(--app-line-strong)",
            }}
          />
          {collection?.name ?? t("detail.unassigned")}
          <span className="pr0-sep">&#10753;</span>
          {prompt.lastUsedAt === null
            ? t("detail.neverUsed")
            : t("detail.lastUsed", {
                date: formatRelative(prompt.lastUsedAt, now, locale),
              })}
          {prompt.archived ? (
            <span className="pr0-badge">{t("detail.archivedBadge")}</span>
          ) : null}
        </div>

        <h2 className="pr0-detail-title">{prompt.title}</h2>

        {prompt.description === "" ? null : (
          <p className="pr0-detail-desc">{prompt.description}</p>
        )}

        <div className="pr0-tags">
          {prompt.tagIds.map((tagId) => {
            const tag = library.tags.find(
              (candidate) => candidate.id === tagId
            );
            return (
              <span className="pr0-tag" key={tagId}>
                {`#${tag?.name ?? tagId}`}
              </span>
            );
          })}
        </div>

        <div className="pr0-actions">
          <button className="pr0-accent" onClick={onCopy} type="button">
            <Copy aria-hidden="true" size={15} />
            {t("detail.copy")}
          </button>
          <span className="pr0-kbd">&#8984;&#8629;</span>
          <span className="pr0-spacer" />

          <button className="pr0-pill" onClick={onEdit} type="button">
            <Pencil aria-hidden="true" size={14} />
            {t("detail.edit")}
          </button>

          <button
            aria-label={t("detail.favorite")}
            aria-pressed={prompt.favorite}
            className="pr0-icon-btn"
            onClick={onToggleFavorite}
            style={{
              color: prompt.favorite ? "var(--orange-500)" : undefined,
            }}
            type="button"
          >
            <Star
              aria-hidden="true"
              fill={prompt.favorite ? "currentColor" : "none"}
              size={16}
            />
          </button>

          <div className="pr0-menu" ref={menuRef}>
            <button
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={t("detail.more")}
              className="pr0-icon-btn"
              onClick={() => setMenuOpen(!menuOpen)}
              type="button"
            >
              <Ellipsis aria-hidden="true" size={16} />
            </button>

            {menuOpen ? (
              <div className="pr0-menu-list" role="menu">
                <button
                  className="pr0-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onDuplicate();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Copy aria-hidden="true" size={15} />
                  {t("detail.duplicate")}
                </button>
                <button
                  className="pr0-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleArchive();
                  }}
                  role="menuitem"
                  type="button"
                >
                  {prompt.archived ? (
                    <ArchiveRestore aria-hidden="true" size={15} />
                  ) : (
                    <Archive aria-hidden="true" size={15} />
                  )}
                  {prompt.archived ? t("detail.restore") : t("detail.archive")}
                </button>
                <button
                  className="pr0-menu-item"
                  data-danger="true"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Trash aria-hidden="true" size={15} />
                  {t("detail.delete")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="pr0-content">
        <div className="pr0-content-head">
          <FileText aria-hidden="true" size={13} />
          {t("detail.promptLabel")}
          <span className="pr0-spacer" />
          <span>{t("detail.variables", { count: variables.length })}</span>
        </div>
        <pre className="pr0-content-body">
          {splitContent(prompt.content).map((segment, index) =>
            segment.kind === "variable" ? (
              <span
                className="pr0-var"
                // biome-ignore lint/suspicious/noArrayIndexKey: static segmentation
                key={`${segment.name}-${index}`}
              >
                {segment.text}
              </span>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: static segmentation
              <span key={`text-${index}`}>{segment.text}</span>
            )
          )}
        </pre>
      </div>

      <div className="pr0-detail-foot">
        <span>
          {t("detail.created", { date: formatDate(prompt.createdAt, locale) })}
        </span>
        <span className="pr0-sep">&#10753;</span>
        <span>
          {t("detail.modified", {
            date: formatRelative(prompt.modifiedAt, now, locale),
          })}
        </span>
        <span className="pr0-sep">&#10753;</span>
        <span>{t("detail.copies", { count: prompt.useCount })}</span>
      </div>
    </div>
  );
};
