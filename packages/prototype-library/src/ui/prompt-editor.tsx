/** PROTOTYPE (issue #9) — create/edit dialog. */

import { useTranslate } from "@tolgee/react";
import { Braces, X } from "lucide-react";
import { useState } from "react";

import type { DraftErrors } from "../domain/lifecycle";
import { validateDraft } from "../domain/lifecycle";
import type { CollectionId, Library, Prompt } from "../domain/types";
import { extractVariables } from "../domain/variables";

export interface EditorDraft {
  title: string;
  description: string;
  content: string;
  collectionId: CollectionId | null;
  tagNames: string[];
}

export interface PromptEditorProps {
  library: Library;
  /** Null when creating. */
  prompt: Prompt | null;
  /** Prefills the title when the launcher had a query and no match. */
  initialTitle?: string;
  onSave: (draft: EditorDraft) => void;
  onCancel: () => void;
}

export const PromptEditor = ({
  library,
  prompt,
  initialTitle = "",
  onSave,
  onCancel,
}: PromptEditorProps) => {
  const { t } = useTranslate();

  const [title, setTitle] = useState(prompt?.title ?? initialTitle);
  const [description, setDescription] = useState(prompt?.description ?? "");
  const [content, setContent] = useState(prompt?.content ?? "");
  const [collectionId, setCollectionId] = useState<CollectionId | null>(
    prompt?.collectionId ?? null
  );
  const [tagText, setTagText] = useState(
    prompt === null
      ? ""
      : prompt.tagIds
          .map(
            (tagId) =>
              library.tags.find((tag) => tag.id === tagId)?.name ?? tagId
          )
          .join(", ")
  );
  const [errors, setErrors] = useState<DraftErrors>({});

  const variables = extractVariables(content);
  const varHint =
    variables.length === 0
      ? t("editor.varHint", { token: "{{variable}}" })
      : t("editor.varHint", {
          token: variables.map((name) => `{{${name}}}`).join(" ⬤ "),
        });

  const submit = () => {
    const found = validateDraft({ title, content });
    setErrors(found);
    if (found.title !== undefined || found.content !== undefined) {
      return;
    }
    onSave({
      title,
      description,
      content,
      collectionId,
      tagNames: tagText.split(","),
    });
  };

  return (
    <div className="pr0-dialog" style={{ width: "min(780px, 94vw)" }}>
      <div className="pr0-dialog-head">
        <div style={{ flex: 1, display: "grid", gap: 6 }}>
          <span className="pr0-dialog-eyebrow">
            {prompt === null
              ? t("editor.eyebrow.new")
              : t("editor.eyebrow.edit")}
          </span>
          <h2 className="pr0-dialog-title">
            {prompt === null ? t("editor.headline.new") : title}
          </h2>
        </div>
        <button
          aria-label={t("editor.cancel")}
          className="pr0-close"
          onClick={onCancel}
          type="button"
        >
          <X aria-hidden="true" size={15} />
        </button>
      </div>

      <div className="pr0-dialog-body">
        <label className="pr0-field">
          <span>{t("editor.field.title")}</span>
          <input
            className="pr0-input"
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("editor.placeholder.title")}
            value={title}
          />
          {errors.title === undefined ? null : (
            <span className="pr0-error">{t("editor.error.title")}</span>
          )}
        </label>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        >
          <label className="pr0-field">
            <span>{t("editor.field.collection")}</span>
            <select
              className="pr0-select"
              onChange={(event) =>
                setCollectionId(
                  event.target.value === "" ? null : event.target.value
                )
              }
              value={collectionId ?? ""}
            >
              <option value="">{t("collections.none")}</option>
              {library.collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </label>

          <label className="pr0-field">
            <span>{t("editor.field.tags")}</span>
            <input
              className="pr0-input pr0-mono"
              onChange={(event) => setTagText(event.target.value)}
              placeholder={t("editor.placeholder.tags")}
              value={tagText}
            />
          </label>
        </div>

        <label className="pr0-field">
          <span>{t("editor.field.description")}</span>
          <input
            className="pr0-input"
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("editor.placeholder.description")}
            value={description}
          />
        </label>

        <label className="pr0-field">
          <span>{t("editor.field.content")}</span>
          <textarea
            className="pr0-textarea"
            onChange={(event) => setContent(event.target.value)}
            rows={10}
            value={content}
          />
          {errors.content === undefined ? null : (
            <span className="pr0-error">{t("editor.error.content")}</span>
          )}
        </label>
      </div>

      <div className="pr0-dialog-foot">
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--app-ink-3)",
          }}
        >
          <Braces aria-hidden="true" size={14} />
          {varHint}
        </span>
        <span className="pr0-spacer" />
        <button className="pr0-pill" onClick={onCancel} type="button">
          {t("editor.cancel")}
        </button>
        <button className="pr0-accent" onClick={submit} type="button">
          {t("editor.save")}
        </button>
      </div>
    </div>
  );
};
