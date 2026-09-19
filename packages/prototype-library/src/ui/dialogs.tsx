/** PROTOTYPE (issue #9) — variable prompt and destructive confirmation. */

import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";

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
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // The launcher flow is keyboard-only up to this point; landing here with
  // nothing focused forces a reach for the mouse. Reported while driving the
  // desktop build for issue #9.
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  return (
    <form
      className="pr0-dialog"
      onSubmit={(event) => {
        // Enter submits from any field, so the whole flow stays on the keyboard.
        event.preventDefault();
        onCopy(values);
      }}
      style={{ width: "min(540px, 94vw)" }}
    >
      <div className="pr0-dialog-head" style={{ display: "grid", gap: 6 }}>
        <span className="pr0-dialog-eyebrow">{t("vars.eyebrow")}</span>
        <h2 className="pr0-dialog-title">{prompt.title}</h2>
      </div>

      <div className="pr0-dialog-body">
        {names.map((name, index) => (
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
              ref={index === 0 ? firstFieldRef : undefined}
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
        <button className="pr0-accent" type="submit">
          {t("vars.copy")}
        </button>
      </div>
    </form>
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
