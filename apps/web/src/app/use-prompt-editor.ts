"use client";

import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import {
  promptTextSchema,
  promptLimits,
  trimPromptText,
  utf8Bytes,
  promptTextFields,
  conflictCopyTitle,
} from "@pr0/api-contract/prompts";
import type {
  MutationEnvelope,
  PromptText,
  Prompt,
  MutationReceipt,
  CreatePrompt,
  UpdatePrompt,
} from "@pr0/api-contract/prompts";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { writeClipboard } from "./clipboard";
import { useReportAttention } from "./library-attention";
import { promptSaveNotice } from "./prompt-save-notice";

type PromptDraft = PromptText & { collectionId: string | null };
const editorFields = [...promptTextFields, "collectionId"] as const;
const textOf = (
  text: PromptText & { collectionId?: string | null }
): PromptDraft => ({
  collectionId: text.collectionId ?? null,
  title: trimPromptText(text.title),
  description: trimPromptText(text.description),
  content: text.content,
});
const sameText = (
  a: PromptText & { collectionId?: string | null },
  b: PromptText & { collectionId?: string | null }
) => editorFields.every((field) => textOf(a)[field] === textOf(b)[field]);
export const usePromptEditor = ({
  library,
  prompt,
  onSaved,
  onAccepted,
  onCancel,
  onDirtyChange,
}: {
  library: PrivateLibrary;
  prompt?: Prompt;
  onSaved: (receipt: MutationReceipt) => void;
  onAccepted: () => void | Promise<void>;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) => {
  const client = useApiClient();
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<PromptDraft>(
    prompt
      ? textOf(prompt)
      : {
          title: "",
          description: "",
          content: "",
          collectionId: null,
        }
  );
  const latestDraft = useRef(draft);
  const [baseline, setBaseline] = useState(
    prompt
      ? { id: prompt.id, revision: prompt.revision, text: textOf(prompt) }
      : null
  );
  const [mappedOriginal, setMappedOriginal] = useState<string | null>(null);
  const [state, setState] = useState<{
    status: "draft" | "saving" | "failed";
    message: string;
    fields: Record<string, string>;
    uncertain: boolean;
  }>({ status: "draft", message: "", fields: {}, uncertain: false });
  useReportAttention(
    state.status === "failed"
      ? "Prompt not saved. Retry, correct the draft or copy its text in the editor."
      : "",
    "editor-heading"
  );
  const [copyMessage, setCopyMessage] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pending = useRef<
    | (Omit<MutationEnvelope, "operations"> & {
        operations: (CreatePrompt | UpdatePrompt)[];
      })
    | null
  >(null);
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const dirty = baseline
    ? !sameText(draft, baseline.text)
    : Boolean(
        draft.title ||
        draft.description ||
        draft.content ||
        draft.collectionId ||
        tagIds.length
      );
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!dirty && state.status !== "saving" && !state.uncertain) {
      return;
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, state.status, state.uncertain]);
  const change = (input: PromptText & { collectionId?: string | null }) => {
    const value = {
      ...input,
      collectionId:
        input.collectionId === undefined
          ? latestDraft.current.collectionId
          : input.collectionId,
    };
    latestDraft.current = value;
    setDraft(value);
    onDirtyChange(
      Boolean(pending.current) ||
        (baseline
          ? !sameText(value, baseline.text)
          : Boolean(
              value.title ||
              value.description ||
              value.content ||
              value.collectionId ||
              tagIds.length
            ))
    );
    setState((previous) =>
      previous.status === "saving" || previous.uncertain
        ? previous
        : { status: "draft", message: "", fields: {}, uncertain: false }
    );
    setCopyMessage("");
  };
  const accept = async (
    result: MutationReceipt,
    submitted: CreatePrompt | UpdatePrompt
  ) => {
    await onAccepted();
    const acceptedText = {
      ...textOf(submitted.desired),
      title: result.conflict
        ? conflictCopyTitle(submitted.desired.title)
        : submitted.desired.title,
    };
    const successor = !sameText(latestDraft.current, submitted.desired);
    setBaseline({
      id: result.conflict?.copyId ?? result.promptId,
      revision: result.revision,
      text: acceptedText,
    });
    if (result.conflict) {
      setMappedOriginal(result.promptId);
    }
    pending.current = null;
    if (successor) {
      const retained = { ...latestDraft.current };
      for (const field of promptTextFields) {
        if (textOf(retained)[field] === submitted.desired[field]) {
          retained[field] = acceptedText[field];
        }
      }
      if (
        latestDraft.current.collectionId ===
        (submitted.desired.collectionId ?? null)
      ) {
        retained.collectionId = acceptedText.collectionId;
      }
      latestDraft.current = retained;
      setDraft(retained);
      onDirtyChange(true);
      setState({
        status: "draft",
        message: promptSaveNotice(
          result,
          "The earlier edit was saved to server. Your newer changes still need Save."
        ),
        fields: {},
        uncertain: false,
      });
    } else {
      onDirtyChange(false);
      onSaved(result);
    }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) {
      return;
    }
    const requested = pending.current?.operations[0]?.desired ?? draft;
    const parsed = promptTextSchema.safeParse({
      title: requested.title,
      description: requested.description,
      content: requested.content,
    });
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
      const saved = baseline;
      const desired = textOf({
        ...parsed.data,
        collectionId: draft.collectionId,
      });
      const operation = saved
        ? {
            operationId: crypto.randomUUID(),
            kind: "prompt.update" as const,
            promptId: saved.id,
            baseRevision: saved.revision,
            dependsOn: [],
            base: saved.text,
            desired,
            changedFields: editorFields.filter(
              (field) => desired[field] !== saved.text[field]
            ),
          }
        : {
            operationId: crypto.randomUUID(),
            kind: "prompt.create" as const,
            promptId: crypto.randomUUID(),
            baseRevision: library.revision,
            dependsOn: [],
            desired: { ...desired, tagIds },
          };
      pending.current = {
        protocolVersion: 1,
        instanceId: library.instance.id,
        accountId: library.account.id,
        epoch: library.epoch,
        installationId: crypto.randomUUID(),
        operations: [operation],
      };
    }
    inFlight.current = true;
    onDirtyChange(true);
    setState({ status: "saving", message: "", fields: {}, uncertain: false });
    try {
      const response = await client.mutatePrompts(
        pending.current,
        AbortSignal.timeout(30_000)
      );
      const [result] = response.results;
      if (result?.status === "accepted" && "promptId" in result) {
        const [submitted] = pending.current.operations;
        if (!submitted) {
          return;
        }
        await accept(result, submitted);
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
      await writeClipboard(() => draft.content);
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
  if (!dirty) {
    statusText = "No unsaved changes";
  }
  if (state.status === "saving") {
    statusText = "Saving…";
  }
  if (state.status === "failed") {
    statusText = `Not saved. ${state.message}`;
  }
  return {
    tagIds,
    changeTags: (ids: string[]) => {
      setTagIds(ids);
      onDirtyChange(
        Boolean(
          ids.length ||
          draft.title ||
          draft.description ||
          draft.content ||
          draft.collectionId
        )
      );
    },
    draft,
    state,
    mappedOriginal,
    copyMessage,
    confirmDiscard,
    setConfirmDiscard,
    titleRef,
    statusRef,
    dirty,
    change,
    save,
    copy,
    discard,
    nearingFieldLimit,
    statusText,
  };
};
