import { parseTemplate, substituteTemplate } from "@pr0/api-contract/variables";
import { VariablesDialogBody } from "@pr0/ui/components/variables-dialog-body";
import { WayfinderDialog } from "@pr0/ui/components/wayfinder-dialog";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { usePromptCopy } from "./use-prompt-copy";

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
          cancelLabel={inline ? "Back to results" : "Cancel"}
          onValueChange={(name, value) =>
            setValues(new Map(values).set(name, value))
          }
          onSubmit={submit}
          onRestart={() => {
            void copy.restartVariables();
          }}
          onCancel={() => copy.cancelVariables()}
        />
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
