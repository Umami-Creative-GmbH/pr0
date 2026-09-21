import { parseTemplate, substituteTemplate } from "@pr0/api-contract/variables";
import {
  DialogHead,
  WayfinderDialog,
} from "@pr0/ui/components/wayfinder-dialog";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { usePromptCopy } from "./use-prompt-copy";

const buttonClass = "wf-btn";
type Copy = ReturnType<typeof usePromptCopy>;

const VariableContainer = ({
  inline,
  children,
  onClose,
  opener,
}: {
  inline: boolean;
  children: ReactNode;
  onClose: () => void;
  opener: Element | null;
}) =>
  inline ? (
    <section
      aria-label="Fill prompt variables"
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </section>
  ) : (
    <WayfinderDialog
      label="Fill prompt variables"
      onRequestClose={onClose}
      opener={opener}
      size="sm"
    >
      {children}
    </WayfinderDialog>
  );

const VariableDialog = ({
  copy,
  interaction,
  inline,
}: {
  inline: boolean;
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
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!inline) {
      return;
    }
    dialogRef.current?.querySelector("textarea")?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, [inline, opener]);
  if (previousTemplate !== template) {
    setPreviousTemplate(template);
    const names = new Set(template.fields.map((field) => field.name));
    const retained = new Map([...values].filter(([name]) => names.has(name)));
    setValues(retained);
    const result = substituteTemplate(template, retained);
    setErrors(result.ok ? new Map() : result.fields);
    setMessage(result.ok ? "" : result.message);
  }
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
    void copy.copy(prompt.id, { content: prompt.content, text: result.text });
  };
  return (
    <VariableContainer
      inline={inline}
      onClose={() => copy.cancelVariables()}
      opener={opener}
    >
      <div className="flex min-h-0 flex-1 flex-col" ref={dialogRef}>
        <DialogHead
          eyebrow="Variables"
          title="Fill prompt variables"
          titleId="variables-heading"
        />
        <form
          autoComplete="off"
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="wf-dialog-body">
            <p className="wf-row-title">{prompt.title}</p>
            <p className="wf-hint">
              All values are required and kept only for this copy interaction.
              Each value and the combined output may use at most 256 KiB.
            </p>
            <details className="wf-hint">
              <summary>Frozen template</summary>
              <pre className="wf-mono mt-2 max-h-48 overflow-auto break-words whitespace-pre-wrap">
                {prompt.content}
              </pre>
            </details>
            {changed ? (
              <div role="alert" className="wf-notice">
                <p>
                  Template changed. Restart with the updated template before
                  copying.
                </p>
                <button
                  className={`${buttonClass} mt-2`}
                  disabled={copy.busy}
                  type="button"
                  onClick={() => copy.restartVariables()}
                >
                  Restart with updated template
                </button>
              </div>
            ) : null}
            <fieldset disabled={copy.busy} className="flex flex-col gap-4">
              <legend className="sr-only">Variable values</legend>
              {template.fields.map((field, index) => (
                <div className="wf-field" key={field.name}>
                  <label
                    className="wf-label"
                    data-kind="variable"
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
                      errors.has(field.name)
                        ? `variable-error-${index}`
                        : undefined
                    }
                    placeholder={`Value for ${field.name}`}
                    rows={field.type === "number" ? 1 : 3}
                    value={values.get(field.name) ?? ""}
                    onChange={(event) => {
                      setValues(
                        new Map(values).set(field.name, event.target.value)
                      );
                    }}
                  />
                  {errors.has(field.name) ? (
                    <p id={`variable-error-${index}`} className="wf-error">
                      {errors.get(field.name)}
                    </p>
                  ) : null}
                </div>
              ))}
            </fieldset>
            <p className="wf-error" role="alert">
              {message}
            </p>
            <output className="wf-notice">{copy.message}</output>
          </div>
          <footer className="wf-dialog-foot">
            <span className="wf-grow">Every value is required.</span>
            <button
              className={buttonClass}
              disabled={copy.busy}
              type="button"
              onClick={() => copy.cancelVariables()}
            >
              {inline ? "Back to results" : "Cancel"}
            </button>
            <button
              className="wf-btn-accent"
              type="submit"
              disabled={changed || copy.busy}
            >
              {copy.busy ? "Copying…" : "Copy"}
            </button>
          </footer>
        </form>
      </div>
    </VariableContainer>
  );
};

export const PromptVariables = ({
  copy,
  inline = false,
}: {
  copy: Copy;
  inline?: boolean;
}) =>
  copy.interaction ? (
    <VariableDialog
      copy={copy}
      interaction={copy.interaction}
      inline={inline}
    />
  ) : null;
