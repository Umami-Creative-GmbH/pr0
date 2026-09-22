import { useTranslations } from "../hooks/use-translations";
import { LocalizedMessage } from "./localized-message";
import { DialogHead } from "./wayfinder-dialog";

const buttonClass = "wf-btn";

interface VariableField {
  name: string;
  type: "string" | "number";
}

/** Presentation only: each platform owns the copy interaction and dialog lifecycle. */
export const VariablesDialogBody = ({
  title,
  content,
  fields,
  values,
  errors,
  message,
  copyMessage,
  busy,
  changed,
  cancelLabel,
  onValueChange,
  onSubmit,
  onRestart,
  onCancel,
}: {
  title: string;
  content: string;
  fields: readonly VariableField[];
  values: ReadonlyMap<string, string>;
  errors: ReadonlyMap<string, string>;
  message: string;
  copyMessage: string;
  busy: boolean;
  changed: boolean;
  cancelLabel: string;
  onValueChange: (name: string, value: string) => void;
  onSubmit: () => void;
  onRestart: () => void;
  onCancel: () => void;
}) => {
  const t = useTranslations();
  return (
    <>
      <DialogHead
        eyebrow={t("variables")}
        title={t("fillPromptVariables")}
        titleId="variables-heading"
      />
      <form
        autoComplete="off"
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="wf-dialog-body">
          <p className="wf-row-title">{title}</p>
          <p className="wf-hint">
            {t("allValuesAreRequiredAndKeptOnlyForThisCopy")}
          </p>
          <details className="wf-hint">
            <summary>{t("frozenTemplate")}</summary>
            <pre className="wf-mono mt-2 max-h-48 overflow-auto break-words whitespace-pre-wrap">
              {content}
            </pre>
          </details>
          {changed ? (
            <div role="alert" className="wf-notice">
              <p>
                {t("templateChangedRestartWithTheUpdatedTemplateBeforeCopying")}
              </p>
              <button
                className={`${buttonClass} mt-2`}
                disabled={busy}
                type="button"
                onClick={onRestart}
              >
                {t("restartWithUpdatedTemplate")}
              </button>
            </div>
          ) : null}
          <fieldset disabled={busy} className="flex flex-col gap-4">
            <legend className="sr-only">{t("variableValues")}</legend>
            {fields.map((field, index) => (
              <div className="wf-field" key={field.name}>
                <label
                  className="wf-label"
                  data-kind="variable"
                  htmlFor={`variable-${index}`}
                >
                  {field.name} (
                  {t(field.type === "number" ? "numberType" : "stringType")})
                </label>
                <textarea
                  id={`variable-${index}`}
                  autoComplete="off"
                  spellCheck={false}
                  inputMode={field.type === "number" ? "decimal" : "text"}
                  aria-required="true"
                  aria-invalid={errors.has(field.name)}
                  aria-describedby={
                    errors.has(field.name)
                      ? `variable-error-${index}`
                      : undefined
                  }
                  placeholder={t("valueForValue", [field.name])}
                  rows={field.type === "number" ? 1 : 3}
                  value={values.get(field.name) ?? ""}
                  onChange={(event) => {
                    onValueChange(field.name, event.target.value);
                  }}
                />
                {errors.has(field.name) ? (
                  <p id={`variable-error-${index}`} className="wf-error">
                    <LocalizedMessage value={errors.get(field.name)} />
                  </p>
                ) : null}
              </div>
            ))}
          </fieldset>
          <p className="wf-error" role="alert">
            <LocalizedMessage value={message} />
          </p>
          <output className="wf-notice">
            <LocalizedMessage value={copyMessage} />
          </output>
        </div>
        <footer className="wf-dialog-foot">
          <span className="wf-grow">{t("everyValueIsRequired")}</span>
          <button
            className={buttonClass}
            disabled={busy}
            type="button"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className="wf-btn-accent"
            type="submit"
            disabled={changed || busy}
          >
            {busy ? t("copying") : t("copy")}
          </button>
        </footer>
      </form>
    </>
  );
};
