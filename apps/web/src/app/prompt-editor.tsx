"use client";

import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import {
  promptTextSchema,
  promptLimits,
  trimPromptText,
  utf8Bytes,
} from "@pr0/api-contract/prompts";
import type { MutationEnvelope, PromptText } from "@pr0/api-contract/prompts";
import { PromptFields } from "@pr0/ui/components/prompt-fields";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

const buttonClass =
  "rounded-md border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
export const PromptEditor = ({
  library,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  library: PrivateLibrary;
  onSaved: (id: string) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) => {
  const client = useApiClient();
  const [draft, setDraft] = useState<PromptText>({
    title: "",
    description: "",
    content: "",
  });
  const [state, setState] = useState<{
    status: "draft" | "saving" | "failed";
    message: string;
    fields: Record<string, string>;
    uncertain: boolean;
  }>({ status: "draft", message: "", fields: {}, uncertain: false });
  const [copyMessage, setCopyMessage] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pending = useRef<MutationEnvelope | null>(null);
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const dirty = Boolean(draft.title || draft.description || draft.content);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const change = (value: PromptText) => {
    setDraft(value);
    onDirtyChange(Boolean(value.title || value.description || value.content));
    setState({ status: "draft", message: "", fields: {}, uncertain: false });
    setCopyMessage("");
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) {
      return;
    }
    const parsed = promptTextSchema.safeParse(draft);
    if (!parsed.success) {
      setState({
        status: "failed",
        message:
          "Correct the highlighted fields. Your text has not been truncated.",
        fields: Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ])
        ),
        uncertain: false,
      });
      statusRef.current?.focus();
      return;
    }
    if (!pending.current) {
      pending.current = {
        protocolVersion: 1,
        instanceId: library.instance.id,
        accountId: library.account.id,
        epoch: library.epoch,
        installationId: crypto.randomUUID(),
        operations: [
          {
            operationId: crypto.randomUUID(),
            kind: "prompt.create",
            promptId: crypto.randomUUID(),
            baseRevision: library.revision,
            dependsOn: [],
            desired: parsed.data,
          },
        ],
      };
    }
    inFlight.current = true;
    setState({ status: "saving", message: "", fields: {}, uncertain: false });
    try {
      const response = await client.mutatePrompts(
        pending.current,
        AbortSignal.timeout(30_000)
      );
      const [result] = response.results;
      if (result?.status === "accepted") {
        pending.current = null;
        onDirtyChange(false);
        onSaved(result.promptId);
      } else if (result?.status === "rejected") {
        // Only failures reached after receipt lookup establish that this operation did not commit.
        const uncertain = ![
          "validation_failed",
          "quota_exceeded",
          "dependency_blocked",
          "identity_unavailable",
        ].includes(result.error.code);
        if (!uncertain) {
          pending.current = null;
        }
        setState({
          status: "failed",
          message: result.error.message,
          fields: result.error.fields ?? {},
          uncertain,
        });
      }
    } catch (error) {
      setState({
        status: "failed",
        message:
          error instanceof PromptApiError
            ? error.message
            : "The server did not confirm saving. Retry to find out whether your prompt was saved.",
        fields: {},
        uncertain: true,
      });
    }
    inFlight.current = false;
    statusRef.current?.focus();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.content);
      setCopyMessage("Copied text.");
    } catch {
      setCopyMessage(
        "Could not copy text. Select the content and copy it manually, or try Copy text again."
      );
    }
  };
  const discard = () => {
    onDirtyChange(false);
    onCancel();
  };
  const nearingFieldLimit =
    [...trimPromptText(draft.title)].length >= promptLimits.title * 0.9 ||
    [...trimPromptText(draft.description)].length >=
      promptLimits.description * 0.9 ||
    utf8Bytes(draft.content) >= promptLimits.contentBytes * 0.9;
  let statusText = "Unsaved changes";
  if (state.status === "saving") {
    statusText = "Saving…";
  }
  if (state.status === "failed") {
    statusText = `Not saved. ${state.message}`;
  }
  return (
    <section aria-labelledby="editor-heading" className="rounded-lg border p-6">
      <h2 className="text-xl font-semibold" id="editor-heading">
        Create prompt
      </h2>
      <p className="text-muted-foreground mt-2 text-sm">
        Only title and content are required. This draft stays in this open tab;
        closing or reloading the tab may lose it.
      </p>
      <p aria-live="polite" className="my-3" ref={statusRef} tabIndex={-1}>
        {statusText}
      </p>
      {state.uncertain ? (
        <p className="mb-3 text-sm">
          Retry to confirm the previous Save before changing the text. Copy text
          remains available.
        </p>
      ) : null}
      {nearingFieldLimit ? (
        <p className="mb-3 text-sm">
          A prompt field is at or above 90% of its limit. Input is never
          truncated.
        </p>
      ) : null}
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <PromptFields
          errors={state.fields}
          onChange={change}
          readOnly={state.status === "saving" || state.uncertain}
          titleRef={titleRef}
          value={draft}
        />
        <div className="flex flex-wrap gap-3">
          <button
            className={buttonClass}
            disabled={state.status === "saving"}
            type="submit"
          >
            {state.status === "failed" ? "Retry" : "Save"}
          </button>
          <button
            className={buttonClass}
            onClick={() => {
              void copy();
            }}
            type="button"
          >
            Copy text
          </button>
          <button
            className={buttonClass}
            disabled={state.status === "saving"}
            onClick={() => {
              if (dirty) {
                setConfirmDiscard(true);
              } else {
                discard();
              }
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      </form>
      {confirmDiscard ? (
        <section
          aria-label="Discard unsaved prompt"
          className="mt-4 rounded-md border p-3"
        >
          <p>
            {state.uncertain
              ? "Discard this open-tab draft? The server may already have saved this prompt. Retry first to confirm its outcome."
              : "Discard this unsaved prompt? Your draft will be lost."}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button className={buttonClass} onClick={discard} type="button">
              Discard draft
            </button>
            <button
              className={buttonClass}
              onClick={() => {
                setConfirmDiscard(false);
                titleRef.current?.focus();
              }}
              type="button"
            >
              Keep editing
            </button>
          </div>
        </section>
      ) : null}
      <p aria-live="polite" className="mt-3 text-sm">
        {copyMessage}
      </p>
    </section>
  );
};
