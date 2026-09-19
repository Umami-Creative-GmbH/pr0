/** PROTOTYPE (issue #9) — variable prompt and destructive confirmation. */

import { useTranslate } from "@tolgee/react";
import { useState } from "react";

import type { Prompt } from "../domain/types";
import { extractVariables } from "../domain/variables";

export interface VariablesDialogProps {
  prompt: Prompt;
  onCopy: (values: Record<string, string>) => void;
  onCancel: () => void;
}

export const VariablesDialog = ({
  prompt,
  onCopy,
  onCancel,
}: VariablesDialogProps) => {
  const { t } = useTranslate();
  const names = extractVariables(prompt.content);
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <div className="pr0-dialog" style={{ width: "min(540px, 94vw)" }}>
      <div className="pr0-dialog-head" style={{ display: "grid", gap: 6 }}>
        <span className="pr0-dialog-eyebrow">{t("vars.eyebrow")}</span>
        <h2 className="pr0-dialog-title">{prompt.title}</h2>
      </div>

      <div className="pr0-dialog-body">
        {names.map((name) => (
          <label className="pr0-field" key={name}>
            <span
              className="pr0-mono"
              style={{
                color: "var(--pink-500)",
                textTransform: "none",
                letterSpacing: 0,
                fontSize: 12,
              }}
            >
              {`{{${name}}}`}
            </span>
            <input
              className="pr0-input"
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [name]: event.target.value,
                }))
              }
              placeholder={t("vars.placeholder", { name })}
              value={values[name] ?? ""}
            />
          </label>
        ))}
      </div>

      <div className="pr0-dialog-foot">
        <span style={{ flex: 1, fontSize: 12, color: "var(--app-ink-3)" }}>
          {t("vars.note")}
        </span>
        <button className="pr0-pill" onClick={onCancel} type="button">
          {t("confirm.cancel")}
        </button>
        <button
          className="pr0-accent"
          onClick={() => onCopy(values)}
          type="button"
        >
          {t("vars.copy")}
        </button>
      </div>
    </div>
  );
};

export interface ConfirmDeleteProps {
  prompt: Prompt;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDelete = ({
  prompt,
  onConfirm,
  onCancel,
}: ConfirmDeleteProps) => {
  const { t } = useTranslate();

  return (
    <div className="pr0-dialog" style={{ width: "min(460px, 94vw)" }}>
      <div className="pr0-dialog-head">
        <h2 className="pr0-dialog-title">{t("confirm.delete.title")}</h2>
      </div>
      <div className="pr0-dialog-body">
        <p style={{ margin: 0, lineHeight: 1.62, color: "var(--app-ink-2)" }}>
          {t("confirm.delete.body", { title: prompt.title })}
        </p>
      </div>
      <div className="pr0-dialog-foot">
        <span className="pr0-spacer" />
        <button className="pr0-pill" onClick={onCancel} type="button">
          {t("confirm.cancel")}
        </button>
        <button
          className="pr0-accent"
          onClick={onConfirm}
          style={{ background: "var(--app-danger)" }}
          type="button"
        >
          {t("confirm.delete.confirm")}
        </button>
      </div>
    </div>
  );
};
