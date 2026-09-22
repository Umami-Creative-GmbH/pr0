import { parseTemplate, substituteTemplate } from "@pr0/api-contract/variables";
import { VariablesDialogBody } from "@pr0/ui/components/variables-dialog-body";
import { useEffect, useMemo, useRef, useState } from "react";

import type { usePromptCopy } from "./use-prompt-copy";

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
      data-size="sm"
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
      <VariablesDialogBody
        title={prompt.title}
        content={prompt.content}
        fields={template.fields}
        values={values}
        errors={errors}
        message={message}
        copyMessage={copy.message}
        busy={copy.busy}
        changed={changed}
        cancelLabel={copy.launcher ? "Back" : "Cancel"}
        onValueChange={(name, value) =>
          setValues(new Map(values).set(name, value))
        }
        onSubmit={submit}
        onRestart={() => {
          void copy.restartVariables();
        }}
        onCancel={() => copy.cancelVariables()}
      />
    </dialog>
  );
};

export const PromptVariables = ({ copy }: { copy: Copy }) =>
  copy.interaction ? (
    <VariableDialog copy={copy} interaction={copy.interaction} />
  ) : null;
