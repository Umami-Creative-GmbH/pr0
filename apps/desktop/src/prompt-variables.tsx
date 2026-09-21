import { parseTemplate, substituteTemplate } from "@pr0/api-contract/variables";
import { useEffect, useMemo, useRef, useState } from "react";

import type { usePromptCopy } from "./use-prompt-copy";

const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
type Copy = ReturnType<typeof usePromptCopy>;

const VariableDialog = ({
  copy,
  interaction,
}: {
  copy: Copy;
  interaction: NonNullable<Copy["interaction"]>;
}) => {
  const { prompt, changed, opener } = interaction;
  const template = useMemo(
    () => parseTemplate(prompt.content),
    [prompt.content]
  );
  const [values, setValues] = useState(new Map<string, string>());
  const [previousTemplate, setPreviousTemplate] = useState(template);
  const [errors, setErrors] = useState(new Map<string, string>());
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  if (previousTemplate !== template) {
    setPreviousTemplate(template);
    const names = new Set(template.fields.map((field) => field.name));
    const retained = new Map([...values].filter(([name]) => names.has(name)));
    setValues(retained);
    const result = substituteTemplate(template, retained);
    setErrors(result.ok ? new Map() : result.fields);
    setMessage(result.ok ? "" : result.message);
  }
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (
        document.hasFocus() &&
        opener instanceof HTMLElement &&
        opener.isConnected
      ) {
        opener.focus();
      }
    };
  }, [opener]);
  const submit = () => {
    if (copy.busy || changed) {
      return;
    }
    const result = substituteTemplate(template, values);
    setErrors(result.ok ? new Map() : result.fields);
    setMessage(result.ok ? "" : result.message);
    if (!result.ok) {
      const index = template.fields.findIndex((field) =>
        result.fields.has(field.name)
      );
      dialogRef.current
        ?.querySelector<HTMLElement>(`#variable-${index}`)
        ?.focus();
      return;
    }
    void copy.submit(prompt, [...values]);
  };
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="variables-heading"
      className="wf-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          copy.cancelVariables();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        copy.cancelVariables();
      }}
    >
      <h2 id="variables-heading" className="text-xl font-semibold">
        Fill prompt variables
      </h2>
      <p className="my-3 break-words">{prompt.title}</p>
      <p>
        All values are required and kept only for this copy interaction. Each
        value and the combined output may use at most 256 KiB.
      </p>
      <details className="my-3">
        <summary>Frozen template</summary>
        <pre className="max-h-48 overflow-auto break-words whitespace-pre-wrap">
          {prompt.content}
        </pre>
      </details>
      {changed ? (
        <div role="alert" className="my-3">
          <p>
            Template changed. Restart with the updated template before copying.
          </p>
          <button
            className={buttonClass}
            disabled={copy.busy}
            type="button"
            onClick={() => {
              void copy.restartVariables();
            }}
          >
            Restart with updated template
          </button>
        </div>
      ) : null}
      <form
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={copy.busy} className="space-y-4">
          <legend className="sr-only">Variable values</legend>
          {template.fields.map((field, index) => (
            <div key={field.name}>
              <label
                className="block font-medium break-words"
                htmlFor={`variable-${index}`}
              >
                {field.name} ({field.type})
              </label>
              <textarea
                id={`variable-${index}`}
                autoComplete="off"
                spellCheck={false}
                inputMode={field.type === "number" ? "decimal" : "text"}
                aria-required="true"
                aria-invalid={errors.has(field.name)}
                aria-describedby={
                  errors.has(field.name) ? `variable-error-${index}` : undefined
                }
                rows={field.type === "number" ? 1 : 3}
                className="mt-1 w-full rounded-md border p-2"
                value={values.get(field.name) ?? ""}
                onChange={(event) => {
                  setValues(
                    new Map(values).set(field.name, event.target.value)
                  );
                }}
              />
              {errors.has(field.name) ? (
                <p id={`variable-error-${index}`} className="text-destructive">
                  {errors.get(field.name)}
                </p>
              ) : null}
            </div>
          ))}
          <p role="alert">{message}</p>
          <output className="block">{copy.message}</output>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className={buttonClass}
              type="button"
              onClick={() => copy.cancelVariables()}
            >
              {copy.launcher ? "Back" : "Cancel"}
            </button>
            <button className={buttonClass} type="submit" disabled={changed}>
              {copy.busy ? "Copying…" : "Copy"}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
};

export const PromptVariables = ({ copy }: { copy: Copy }) =>
  copy.interaction ? (
    <VariableDialog copy={copy} interaction={copy.interaction} />
  ) : null;
