"use client";

import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type {
  MutationEnvelope,
  OrganizationCleanup,
} from "@pr0/api-contract/prompts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { OrganizationReview } from "./organization-review";

export interface CleanupRequest {
  kind: OrganizationCleanup["kind"];
  sourceId: string;
  targetId?: string;
}
const buttonClass = "wf-btn";
const cleanupOperation = (
  request: CleanupRequest,
  revision: string
): OrganizationCleanup => {
  const common = {
    operationId: crypto.randomUUID(),
    baseRevision: revision,
    dependsOn: [],
  };
  if (request.kind === "collection.delete") {
    return { ...common, kind: request.kind, collectionId: request.sourceId };
  }
  if (request.kind === "tag.merge") {
    if (!request.targetId) {
      throw new Error("Choose the merge target.");
    }
    return {
      ...common,
      kind: request.kind,
      tagId: request.sourceId,
      targetId: request.targetId,
    };
  }
  return { ...common, kind: request.kind, tagId: request.sourceId };
};
const actionLabel = (
  kind: CleanupRequest["kind"],
  targetName: string | null
) => {
  if (kind === "tag.merge") {
    return `Merge into ${targetName}`;
  }
  return kind === "collection.delete" ? "Delete collection" : "Delete tag";
};
export const OrganizationCleanupPanel = ({
  library,
  request,
  onCancel,
  onAccepted,
  onBusyChange,
  selected,
}: {
  library: PrivateLibrary;
  request: CleanupRequest | null;
  onCancel: () => void;
  onAccepted: () => void | Promise<void>;
  onBusyChange: (busy: boolean) => void;
  selected: boolean;
}) => {
  const client = useApiClient();
  const scope = {
    instanceId: library.instance.id,
    accountId: library.account.id,
  };
  const impact = useQuery({
    queryKey: ["organization-impact", scope, request],
    enabled: Boolean(request),
    queryFn: ({ signal }) => {
      if (!request) {
        throw new Error("Choose an organization action.");
      }
      return client.getOrganizationImpact(request, signal, scope);
    },
    refetchInterval: 5000,
  });
  const pending = useRef<MutationEnvelope | null>(null);
  const inFlight = useRef(false);
  const focusRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<
    Awaited<ReturnType<typeof client.mutatePrompts>>["results"][number] | null
  >(null);
  useEffect(() => {
    if (request && !impact.isPending) {
      focusRef.current?.focus();
    }
  }, [request, impact.isPending]);
  const confirm = async () => {
    if (inFlight.current || !request || (!pending.current && !impact.data)) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    let remainsUncertain = false;
    try {
      if (!pending.current) {
        const fresh = await client.getOrganizationImpact(
          request,
          AbortSignal.timeout(30_000),
          scope
        );
        if (
          JSON.stringify(fresh.effect) !== JSON.stringify(impact.data?.effect)
        ) {
          await impact.refetch();
          setMessage(
            "The affected counts or names changed. Review the refreshed confirmation and confirm again."
          );
          setBusy(false);
          inFlight.current = false;
          onBusyChange(false);
          return;
        }
        pending.current = {
          protocolVersion: 1,
          ...scope,
          epoch: library.epoch,
          installationId: crypto.randomUUID(),
          operations: [cleanupOperation(request, fresh.revision)],
        };
      }
      const response = await client.mutatePrompts(
        pending.current,
        AbortSignal.timeout(30_000)
      );
      const [receipt] = response.results;
      if (receipt?.status === "accepted" && "effect" in receipt) {
        pending.current = null;
        setResult(receipt);
        setMessage("");
        setUncertain(false);
        onCancel();
        await onAccepted();
      } else if (receipt?.status === "rejected") {
        remainsUncertain = ![
          "validation_failed",
          "quota_exceeded",
          "name_conflict",
          "not_found",
          "results_changed",
          "dependency_blocked",
          "identity_unavailable",
        ].includes(receipt.error.code);
        if (!remainsUncertain) {
          pending.current = null;
        }
        setUncertain(remainsUncertain);
        setMessage(
          `${remainsUncertain ? "Saving is unconfirmed. Retry the original request." : "Not saved."} ${receipt.error.message}`
        );
        await impact.refetch();
      }
    } catch {
      remainsUncertain = Boolean(pending.current);
      setUncertain(remainsUncertain);
      setMessage(
        remainsUncertain
          ? "Saving is unconfirmed. Retry the original request before closing."
          : "Could not refresh the confirmation. Retry when connected."
      );
    }
    setBusy(false);
    inFlight.current = false;
    onBusyChange(remainsUncertain);
  };
  const effect = impact.data?.effect;
  return (
    <div className="space-y-3">
      {request ? (
        <section
          aria-label="Confirm organization change"
          className="space-y-2 rounded-md border p-3"
        >
          {effect ? (
            <>
              <h3 className="font-semibold">
                {request.kind === "tag.merge"
                  ? `Merge “${effect.sourceName}” into “${effect.targetName}”?`
                  : `Delete “${effect.sourceName}”?`}
              </h3>
              <p>
                {effect.activeCount} active prompts and {effect.archivedCount}{" "}
                archived prompts.
              </p>
              {request.kind === "tag.merge" ? (
                <p>
                  {effect.targetName} will remain. Prompts using{" "}
                  {effect.sourceName} will use {effect.targetName}. Prompts
                  using both will have {effect.targetName} once. Result:{" "}
                  {effect.targetActiveCount} active and{" "}
                  {effect.targetArchivedCount} archived prompts. Your prompts
                  will be kept.
                </p>
              ) : (
                <p>
                  {request.kind === "collection.delete"
                    ? "These prompts will become unassigned."
                    : "This tag will be removed from these prompts."}{" "}
                  Your prompts will be kept.
                </p>
              )}
              {selected ? (
                <p>
                  This selected condition will become unavailable and return no
                  matches until you explicitly remove or replace it.
                  {effect.targetName
                    ? ` You can choose Use ${effect.targetName} instead.`
                    : ""}
                </p>
              ) : null}
              <p className="text-sm">
                Counts describe the available server snapshot. The result will
                report the assignments actually changed.
              </p>
              <button
                ref={focusRef}
                type="button"
                className={buttonClass}
                disabled={busy || (impact.isError && !uncertain)}
                onClick={() => {
                  void confirm();
                }}
              >
                {uncertain
                  ? "Retry original action"
                  : actionLabel(request.kind, effect.targetName)}
              </button>
            </>
          ) : (
            <output>Loading affected counts…</output>
          )}
          {impact.isError ? (
            <p role="alert">
              Could not refresh affected counts.{" "}
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  void impact.refetch();
                }}
              >
                Retry confirmation
              </button>
            </p>
          ) : null}
          <button
            type="button"
            className={buttonClass}
            disabled={busy || uncertain}
            onClick={onCancel}
          >
            Cancel
          </button>
        </section>
      ) : null}
      <output>{busy ? "Saving…" : message}</output>
      {result?.status === "accepted" && "effect" in result ? (
        <OrganizationReview
          library={library}
          operationId={result.operationId}
          effect={result.effect}
        />
      ) : null}
    </div>
  );
};
