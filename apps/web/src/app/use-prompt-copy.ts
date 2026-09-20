"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { MutationEnvelope, Prompt } from "@pr0/api-contract/prompts";
import { useEffect, useRef, useState } from "react";

import { writeClipboard } from "./clipboard";

export const usePromptCopy = ({
  library,
  eligible,
  onAccepted,
}: {
  library: PrivateLibrary;
  eligible: (prompt: Prompt) => boolean;
  onAccepted: () => Promise<void>;
}) => {
  const client = useApiClient();
  const alive = useRef(true);
  const pending = useRef<MutationEnvelope | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retryId, setRetryId] = useState<string | null>(null);
  const [usagePending, setUsagePending] = useState(false);
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
    return () => {
      alive.current = false;
    };
  }, []);
  const sendUsage = async () => {
    const envelope = pending.current;
    if (!envelope) {
      return;
    }
    try {
      const {
        results: [result],
      } = await client.mutatePrompts(envelope, AbortSignal.timeout(30_000));
      if (result?.status !== "accepted") {
        usageFailure();
        return;
      }
      pending.current = null;
      if (alive.current) {
        setUsagePending(false);
        setMessage("Copied. Usage recorded.");
        await onAccepted();
      }
    } catch {
      usageFailure();
    }
  };
  const copy = async (id: string) => {
    if (inFlight.current || pending.current) {
      return;
    }
    inFlight.current = true;
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
        if (!alive.current || !eligible(source)) {
          throw new Error(
            "This prompt is no longer available for copying in this view."
          );
        }
        return source.content;
      });
    } catch (error) {
      if (alive.current) {
        setRetryId(id);
        setMessage(
          `Could not copy. ${error instanceof Error ? error.message : "Try again."}`
        );
        setBusy(false);
      }
      inFlight.current = false;
      return;
    }
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
    if (alive.current) {
      setMessage("Copied. Recording usage…");
    }
    await sendUsage();
    inFlight.current = false;
    if (alive.current) {
      setBusy(false);
    }
  };
  const retryUsage = async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    await sendUsage();
    inFlight.current = false;
    if (alive.current) {
      setBusy(false);
    }
  };
  return {
    copy,
    busy,
    blocked: busy || usagePending,
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
