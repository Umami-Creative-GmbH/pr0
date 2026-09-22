"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type {
  MutationEnvelope,
  OrganizationCleanup,
} from "@pr0/api-contract/prompts";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
import { localizeMessage } from "@pr0/ui/lib/message-localization";
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
    return translate("mergeIntoValue", [targetName]);
  }
  return kind === "collection.delete"
    ? translate("deleteCollection")
    : translate("deleteTag");
};
interface OrganizationCleanupPanelProps {
  library: PrivateLibrary;
  request: CleanupRequest | null;
  onCancel: () => void;
  onAccepted: () => void | Promise<void>;
  onBusyChange: (busy: boolean) => void;
  selected: boolean;
}

const useOrganizationCleanup = ({
  library,
  request,
  onCancel,
  onAccepted,
  onBusyChange,
}: Pick<
  OrganizationCleanupPanelProps,
  "library" | "request" | "onCancel" | "onAccepted" | "onBusyChange"
>) => {
  const t = useTranslations();

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
            t("theAffectedCountsOrNamesChangedReviewTheRefreshedConfirmation")
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
          t(remainsUncertain ? "unconfirmedSaveDetail" : "notSavedValue", [
            localizeMessage(receipt.error.message),
          ])
        );
        await impact.refetch();
      }
    } catch {
      remainsUncertain = Boolean(pending.current);
      setUncertain(remainsUncertain);
      setMessage(
        remainsUncertain
          ? t("savingIsUnconfirmedRetryTheOriginalRequestBeforeClosing")
          : t("couldNotRefreshTheConfirmationRetryWhenConnected")
      );
    }
    setBusy(false);
    inFlight.current = false;
    onBusyChange(remainsUncertain);
  };
  return { impact, focusRef, busy, uncertain, message, result, confirm };
};

const CleanupImpact = ({
  model,
  request,
  selected,
}: {
  model: ReturnType<typeof useOrganizationCleanup>;
  request: CleanupRequest;
  selected: boolean;
}) => {
  const t = useTranslations();
  const { impact, focusRef, busy, uncertain, confirm } = model;
  const effect = impact.data?.effect;
  if (!effect) {
    return <output>{t("loadingAffectedCounts")}</output>;
  }
  return (
    <>
      <h3 className="font-semibold">
        {request.kind === "tag.merge"
          ? t("mergeValueIntoValue", [effect.sourceName, effect.targetName])
          : t("deleteValue", [effect.sourceName])}
      </h3>
      <p>
        {effect.activeCount} {t("activePromptsAnd")} {effect.archivedCount}{" "}
        {t("archivedPrompts")}
      </p>
      {request.kind === "tag.merge" ? (
        <p>
          {effect.targetName} {t("willRemainPromptsUsing")} {effect.sourceName}{" "}
          {t("willUse")} {effect.targetName}
          {t("promptsUsingBothWillHave")}
          {effect.targetName} {t("onceResult")} {effect.targetActiveCount}{" "}
          {t("activeAnd")} {effect.targetArchivedCount}{" "}
          {t("archivedPromptsYourPromptsWillBeKept")}
        </p>
      ) : (
        <p>
          {request.kind === "collection.delete"
            ? t("thesePromptsWillBecomeUnassigned")
            : t("thisTagWillBeRemovedFromThesePrompts")}{" "}
          {t("yourPromptsWillBeKept")}
        </p>
      )}
      {selected ? (
        <p>
          {t("thisSelectedConditionWillBecomeUnavailableAndReturnNoMatches")}
          {effect.targetName
            ? t("youCanChooseUseValueInstead", [effect.targetName])
            : ""}
        </p>
      ) : null}
      <p className="text-sm">
        {t("countsDescribeTheAvailableServerSnapshotTheResultWillReport")}
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
          ? t("retryOriginalAction")
          : actionLabel(request.kind, effect.targetName)}
      </button>
    </>
  );
};

export const OrganizationCleanupPanel = ({
  library,
  request,
  onCancel,
  onAccepted,
  onBusyChange,
  selected,
}: OrganizationCleanupPanelProps) => {
  const t = useTranslations();
  const model = useOrganizationCleanup({
    library,
    request,
    onCancel,
    onAccepted,
    onBusyChange,
  });
  const { impact, busy, uncertain, message, result } = model;
  return (
    <div className="space-y-3">
      {request ? (
        <section
          aria-label={t("confirmOrganizationChange")}
          className="space-y-2 rounded-md border p-3"
        >
          <CleanupImpact model={model} request={request} selected={selected} />
          {impact.isError ? (
            <p role="alert">
              {t("couldNotRefreshAffectedCounts")}{" "}
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  void impact.refetch();
                }}
              >
                {t("retryConfirmation")}
              </button>
            </p>
          ) : null}
          <button
            type="button"
            className={buttonClass}
            disabled={busy || uncertain}
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
        </section>
      ) : null}
      <output>{busy ? t("saving") : message}</output>
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
