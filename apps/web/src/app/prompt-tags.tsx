"use client";

import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { MutationEnvelope, Prompt, Tag } from "@pr0/api-contract/prompts";
import { TagPicker } from "@pr0/ui/components/tag-picker";
import { useEffect, useRef, useState } from "react";

import { collectionMatches } from "./collection-query";

const buttonClass = "wf-btn";
export const PromptTags = ({
  library,
  prompt,
  tags,
  onAccepted,
  onDirtyChange,
  onClose,
}: {
  library: PrivateLibrary;
  prompt: Prompt;
  tags: Tag[];
  onAccepted: () => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
}) => {
  const client = useApiClient();
  const [baseline, setBaseline] = useState(prompt);
  const [selected, setSelected] = useState(prompt.tagIds);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [discard, setDiscard] = useState(false);
  const pending = useRef<MutationEnvelope | null>(null);
  const inFlight = useRef(false);
  const baselineIds = new Set(baseline.tagIds);
  const selectedIds = new Set(selected);
  const dirty =
    selected.length !== baseline.tagIds.length ||
    selected.some((id) => !baselineIds.has(id));
  useEffect(() => {
    if (!dirty && !uncertain && !busy) {
      return;
    }
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, uncertain, busy]);
  const save = async () => {
    if (inFlight.current) {
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
            kind: "prompt.tags",
            operationId: crypto.randomUUID(),
            promptId: baseline.id,
            baseRevision: baseline.libraryRevision ?? baseline.revision,
            dependsOn: [],
            add: selected.filter((id) => !baselineIds.has(id)),
            remove: baseline.tagIds.filter((id) => !selectedIds.has(id)),
          },
        ],
      };
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("Saving tags…");
    onDirtyChange(true);
    try {
      const response = await client.mutatePrompts(
        pending.current,
        AbortSignal.timeout(30_000)
      );
      const [result] = response.results;
      if (result?.status === "accepted" && "promptId" in result) {
        setMessage("Tags saved to server. Refreshing assignments…");
        const current = await client.getPrompt(
          baseline.id,
          AbortSignal.timeout(30_000),
          { instanceId: library.instance.id, accountId: library.account.id }
        );
        await onAccepted();
        pending.current = null;
        setBaseline(current);
        setSelected(current.tagIds);
        setUncertain(false);
        setMessage(result.organizationNotice ?? "Tags saved to server.");
        onDirtyChange(false);
      } else if (result?.status === "rejected") {
        const unknown = ![
          "validation_failed",
          "quota_exceeded",
          "not_found",
          "dependency_blocked",
        ].includes(result.error.code);
        if (!unknown) {
          pending.current = null;
        }
        setUncertain(unknown);
        setMessage(`Not saved. ${result.error.message}`);
      }
    } catch {
      setUncertain(true);
      setMessage(
        "Could not confirm current assignments. Keep this editor open and Retry to confirm the original request."
      );
    }
    inFlight.current = false;
    setBusy(false);
  };
  const close = () => {
    onDirtyChange(false);
    onClose();
  };
  return (
    <section
      aria-label={`Edit tags for ${baseline.title}`}
      className="space-y-3 rounded-md border p-4"
    >
      <h2 className="text-xl font-semibold break-words">
        Tags for {baseline.title}
      </h2>
      <TagPicker
        label="Prompt tags"
        tags={tags}
        value={selected}
        search={collectionMatches}
        disabled={busy || uncertain}
        onChange={(ids) => {
          setSelected(ids);
          setMessage("");
          onDirtyChange(true);
        }}
      />
      <p>{selected.length} / 20 tags</p>
      <output>{message}</output>
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={busy || selected.length > 20}
          onClick={() => {
            void save();
          }}
        >
          {uncertain ? "Retry tags" : "Save tags"}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => {
            if (dirty || uncertain) {
              setDiscard(true);
            } else {
              close();
            }
          }}
        >
          Close tags
        </button>
      </div>
      {discard ? (
        <div>
          <p>
            Discard these unsaved tag choices? An unconfirmed request may
            already have been saved.
          </p>
          <button type="button" className={buttonClass} onClick={close}>
            Discard tag choices
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => setDiscard(false)}
          >
            Keep editing tags
          </button>
        </div>
      ) : null}
    </section>
  );
};
