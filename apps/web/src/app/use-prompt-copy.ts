"use client";
import { PromptApiError } from "@pr0/api-client/prompts";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { MutationEnvelope, Prompt } from "@pr0/api-contract/prompts";
import { parseTemplate, substituteTemplate } from "@pr0/api-contract/variables";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { writeClipboard } from "./clipboard";

interface CopyInteraction {
  opener: Element | null;
  prompt: Prompt;
  updated: Prompt;
  changed: boolean;
}
interface CopySubmission {
  content: string;
  text: string;
}
class FillVariablesError extends Error {
  override name = "FillVariablesError";
}

export const usePromptCopy = ({
  library,
  eligible,
  onAccepted,
  libraryRevision,
  accountChanged = false,
  onClipboardWritten,
}: {
  library: PrivateLibrary;
  eligible: (prompt: Prompt) => boolean;
  onAccepted: () => Promise<void>;
  libraryRevision?: string;
  accountChanged?: boolean;
  onClipboardWritten?: () => void;
}) => {
  const client = useApiClient();
  const alive = useRef(true);
  const pending = useRef<MutationEnvelope | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const submitted = useRef<CopySubmission | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retryId, setRetryId] = useState<string | null>(null);
  const [usagePending, setUsagePending] = useState(false);
  const [interaction, setInteraction] = useState<CopyInteraction | null>(null);
  const activeInteraction = useRef<CopyInteraction | null>(null);
  const changeInteraction = (next: CopyInteraction | null) => {
    activeInteraction.current = next;
    setInteraction(next);
  };
  // An external account/page lifecycle event must synchronously retire this interaction, including late-completion presentation.
  /* oxlint-disable react-doctor/no-adjust-state-on-prop-change */
  const endInteraction = useCallback(() => {
    generation.current += 1;
    activeInteraction.current = null;
    if (submitted.current) {
      submitted.current.text = "";
    }
    pending.current = null;
    setInteraction(null);
    setMessage("");
    setBusy(false);
    setRetryId(null);
    setUsagePending(false);
  }, []);
  /* oxlint-enable react-doctor/no-adjust-state-on-prop-change */
  const clearSubmitted = () => {
    if (submitted.current) {
      submitted.current.text = "";
    }
    submitted.current = null;
  };
  const observed = useQuery({
    queryKey: [
      "prompt",
      client.baseUrl,
      library.instance.id,
      library.account.id,
      interaction?.prompt.id ?? "",
    ],
    queryFn: ({ signal }) =>
      client.getPrompt(interaction?.prompt.id ?? "", signal, {
        instanceId: library.instance.id,
        accountId: library.account.id,
      }),
    enabled: Boolean(interaction),
    refetchInterval: interaction ? 5000 : false,
    retry: false,
  });
  const refetchObserved = observed.refetch;
  useEffect(() => {
    if (
      interaction &&
      libraryRevision &&
      BigInt(libraryRevision) > BigInt(observed.data?.libraryRevision ?? "0")
    ) {
      // oxlint-disable-next-line react-doctor/query-no-query-in-effect -- A newer library revision requires checking the frozen template identity, including copies started from an unselected row.
      void refetchObserved();
    }
  }, [
    libraryRevision,
    interaction,
    observed.data?.libraryRevision,
    refetchObserved,
  ]);
  // Query observations invalidate a frozen copy interaction; this is synchronization with external server state.
  /* oxlint-disable react/set-state-in-effect, react-doctor/no-adjust-state-on-prop-change, react-doctor/no-chain-state-updates */
  useEffect(() => {
    const { current } = activeInteraction;
    if (!current) {
      return;
    }
    if (
      observed.error instanceof PromptApiError &&
      observed.error.status === 404
    ) {
      activeInteraction.current = null;
      setInteraction(null);
      setRetryId(null);
      setMessage("This prompt was deleted. Variable values were cleared.");
    } else if (
      observed.data &&
      observed.data.id === current.prompt.id &&
      BigInt(observed.data.revision) >= BigInt(current.updated.revision)
    ) {
      const updated = observed.data;
      if (updated.content !== current.prompt.content || current.changed) {
        const next = { ...current, updated, changed: true };
        activeInteraction.current = next;
        setInteraction(next);
      }
    }
  }, [observed.data, observed.error]);
  /* oxlint-enable react/set-state-in-effect, react-doctor/no-adjust-state-on-prop-change, react-doctor/no-chain-state-updates */
  const usageFailure = () => {
    if (alive.current) {
      setUsagePending(Boolean(pending.current));
      setMessage(
        pending.current
          ? "Copied. Usage was not confirmed. Retry usage before copying another prompt, or discard this usage record. It is retained only in this tab and will be lost if you leave."
          : "Copied. Usage recorded, but results could not refresh. Refresh the list."
      );
    }
  };
  useEffect(() => {
    alive.current = true;
    window.addEventListener("pagehide", endInteraction);
    return () => {
      alive.current = false;
      activeInteraction.current = null;
      if (submitted.current) {
        submitted.current.text = "";
      }
      window.removeEventListener("pagehide", endInteraction);
    };
  }, [endInteraction]);
  useEffect(() => {
    if (accountChanged) {
      // oxlint-disable-next-line react/set-state-in-effect, react-doctor/no-adjust-state-on-prop-change -- An externally observed account switch must end the transient interaction even while an old account draft remains mounted.
      endInteraction();
    }
  }, [accountChanged, endInteraction]);
  const sendUsage = async (current: () => boolean) => {
    const envelope = pending.current;
    if (!envelope) {
      return;
    }
    try {
      const {
        results: [result],
      } = await client.mutatePrompts(envelope, AbortSignal.timeout(30_000));
      if (result?.status !== "accepted") {
        if (current()) {
          usageFailure();
        }
        return;
      }
      pending.current = null;
      if (current()) {
        setUsagePending(false);
        setMessage("Copied. Usage recorded.");
        await onAccepted();
      }
    } catch {
      if (current()) {
        usageFailure();
      }
    }
  };
  const copyFailure = (error: Error, id: string) => {
    const deleted = error instanceof PromptApiError && error.status === 404;
    if (deleted) {
      changeInteraction(null);
    }
    setRetryId(
      error instanceof FillVariablesError ||
        deleted ||
        activeInteraction.current
        ? null
        : id
    );
    setMessage(
      error instanceof FillVariablesError
        ? error.message
        : `Could not copy. ${error.message}`
    );
    setBusy(false);
  };
  const copy = async (id: string, submission?: CopySubmission) => {
    if (inFlight.current || pending.current) {
      return;
    }
    if (
      activeInteraction.current &&
      (!submission || activeInteraction.current.changed)
    ) {
      return;
    }
    inFlight.current = true;
    const opener = document.activeElement;
    const started = generation.current;
    const current = () => alive.current && generation.current === started;
    submitted.current = submission ?? null;
    setBusy(true);
    setRetryId(null);
    setMessage("Copying…");
    let source: Prompt | undefined;
    try {
      await writeClipboard(async () => {
        source = await client.getPrompt(id, AbortSignal.timeout(30_000), {
          instanceId: library.instance.id,
          accountId: library.account.id,
        });
        if (!current() || !eligible(source)) {
          throw new Error(
            "This prompt is no longer available for copying in this view."
          );
        }
        if (submission) {
          const interactionSnapshot = activeInteraction.current;
          if (
            !interactionSnapshot ||
            interactionSnapshot.changed ||
            source.content !== submission.content
          ) {
            if (interactionSnapshot) {
              changeInteraction({
                ...interactionSnapshot,
                updated: source,
                changed: true,
              });
            }
            throw new FillVariablesError(
              "Template changed. Restart with the updated template."
            );
          }
          return submission.text;
        }
        const template = parseTemplate(source.content);
        if (template.fields.length > 0) {
          changeInteraction({
            opener,
            prompt: source,
            updated: source,
            changed: false,
          });
          throw new FillVariablesError(
            "Fill the required variables before copying."
          );
        }
        const result = substituteTemplate(template, new Map());
        if (!result.ok) {
          throw new Error(result.message);
        }
        return result.text;
      });
    } catch (error) {
      clearSubmitted();
      if (current()) {
        copyFailure(
          error instanceof Error ? error : new Error("Try again."),
          id
        );
      }
      inFlight.current = false;
      return;
    }
    clearSubmitted();
    if (current()) {
      changeInteraction(null);
      onClipboardWritten?.();
    }
    // Drop the filled output before awaiting usage delivery. The retry envelope
    // below contains only the original prompt identity and usage metadata.
    // The fallback holds one metadata-only event. Further copies require explicit
    // retry or discard, so failed delivery cannot grow an unbounded memory queue.
    pending.current = {
      protocolVersion: 1,
      instanceId: library.instance.id,
      accountId: library.account.id,
      epoch: library.epoch,
      installationId: crypto.randomUUID(),
      operations: [
        {
          kind: "prompt.use",
          operationId: crypto.randomUUID(),
          promptId: id,
          baseRevision: source?.revision ?? "0",
          dependsOn: [],
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    if (current()) {
      setMessage("Copied. Recording usage…");
    }
    await sendUsage(current);
    if (!current()) {
      pending.current = null;
    }
    inFlight.current = false;
    if (current()) {
      setBusy(false);
    }
  };
  const retryUsage = async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    const started = generation.current;
    const current = () => alive.current && generation.current === started;
    await sendUsage(current);
    inFlight.current = false;
    if (current()) {
      setBusy(false);
    }
  };
  return {
    copy,
    interaction,
    cancelVariables: () => {
      if (!inFlight.current) {
        changeInteraction(null);
        setMessage("");
      }
    },
    restartVariables: () => {
      const { current } = activeInteraction;
      if (current && !inFlight.current) {
        changeInteraction({
          opener: current.opener,
          prompt: current.updated,
          updated: current.updated,
          changed: false,
        });
        setMessage("Template updated. Review the values and choose Copy.");
      }
    },
    busy,
    blocked: busy || usagePending || Boolean(interaction),
    message,
    retryId,
    usagePending,
    retryUsage,
    discardUsage: () => {
      pending.current = null;
      setUsagePending(false);
      setMessage(
        "Copied. Unconfirmed usage discarded; Recents may not reflect this copy."
      );
    },
  };
};
