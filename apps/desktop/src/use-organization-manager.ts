import type {
  LocalOrganization,
  OrganizationAction,
  OrganizationLocalImpact,
  OrganizeRequest,
} from "@pr0/api-contract/local-organization";
import { organizeRequestSchema } from "@pr0/api-contract/local-organization";
import { organizationIdentity } from "@pr0/api-contract/organization";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { organizationClient, organizationError } from "./organization-client";
import type { Status } from "./use-auth-session";

export interface ManagerProps {
  account: Status;
  snapshot: LocalOrganization;
  initialTab: Tab;
  onSaved: () => Promise<void>;
  onClose: () => void;
}

export type Tab = "collections" | "tags";
export interface OrganizationEdit {
  name: string;
  id: string;
  creating?: boolean;
  replaces?: string;
}

export const useOrganizationManager = ({
  account,
  snapshot,
  initialTab,
  onSaved,
  onClose,
}: ManagerProps) => {
  const t = useTranslations();

  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const flight = useRef(false);
  const unresolved = useRef<OrganizeRequest | null>(null);
  const [tab, setTab] = useState(initialTab);
  const [draft, setDraft] = useState<{
    name: string;
    baseline: string;
    id: string | null;
    replaces: string | null;
    creating: boolean;
  }>({
    name: "",
    baseline: "",
    id: null,
    replaces: null,
    creating: true,
  });
  const { name, baseline, id, replaces, creating } = draft;
  const editRevision = useRef(snapshot.localRevision);
  const setName = (value: string) =>
    setDraft((previous) => ({ ...previous, name: value }));
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [errorText, setErrorText] = useState("");
  const [discard, setDiscard] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    action: OrganizationAction;
    impact: OrganizationLocalImpact;
    replaces: string | null;
  }>();
  const [result, setResult] = useState<{
    id: string;
    effect: OrganizationLocalImpact["effect"];
  }>();
  const entity = tab === "collections" ? "collection" : "tag";
  const entries = snapshot[tab];
  const dirty = name !== baseline || uncertain;
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.showModal();
    input.current?.focus();
    const element = dialog.current;
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);
  const clear = () => {
    setDraft({
      name: "",
      baseline: "",
      id: null,
      replaces: null,
      creating: true,
    });
    unresolved.current = null;
    setUncertain(false);
  };
  const close = () => {
    if (busy) {
      return;
    }
    if (dirty) {
      setDiscard(true);
    } else {
      onClose();
    }
  };
  const prepare = async (
    action: OrganizationAction,
    replacement: string | null = replaces
  ) => {
    try {
      setConfirmation({
        action,
        replaces: replacement,
        impact: await organizationClient.impact(action, replacement),
      });
      setErrorText("");
    } catch (error) {
      setErrorText(organizationError(error));
    }
  };
  const recover = async (error: string | null, action: OrganizationAction) => {
    try {
      if (error === "results_changed") {
        if ("name" in action) {
          const current = await organizationClient.snapshot();
          editRevision.current = current.localRevision;
          await onSaved();
        } else {
          await prepare(action);
        }
      }
      if (error === "name_conflict" && action.kind === "tag.rename") {
        try {
          const current = await organizationClient.snapshot();
          const target = current.tags.find(
            (tag) =>
              tag.id !== action.id &&
              organizationIdentity(tag.name) ===
                organizationIdentity(action.name)
          );
          if (target) {
            await prepare({
              kind: "tag.merge",
              id: action.id,
              targetId: target.id,
            });
          }
        } catch {
          setErrorText(t("couldNotRefreshTheMergeDecisionTheNameIsRetained"));
        }
      }
    } catch {
      setErrorText(t("couldNotRefreshTheCurrentStateYourNameIsRetained"));
    }
  };
  const save = async (
    action: OrganizationAction,
    revision?: string,
    replacement: string | null = replaces
  ) => {
    if (flight.current || !account.instanceId || !account.accountId) {
      return;
    }
    flight.current = true;
    setBusy(true);
    setErrorText("");
    const request = unresolved.current ?? {
      instanceId: account.instanceId,
      accountId: account.accountId,
      generation: account.generation,
      operationId: crypto.randomUUID(),
      action,
      replaces: replacement,
      expectedLocalRevision:
        revision ?? (creating ? snapshot.localRevision : editRevision.current),
    };
    const parsed = organizeRequestSchema.safeParse(request);
    if (!parsed.success) {
      setErrorText(parsed.error.issues[0]?.message ?? t("correctTheName"));
      flight.current = false;
      setBusy(false);
      return;
    }
    unresolved.current = request;
    try {
      const saved = await organizationClient.save(request);
      unresolved.current = null;
      setMessage(
        saved.existing
          ? t("thisTagAlreadyExistsNoPromptsWereAssigned")
          : t("savedOnThisDeviceChangesWaitingToSync")
      );
      if (saved.effect) {
        setResult({ id: request.operationId, effect: saved.effect });
      }
      setConfirmation(undefined);
      clear();
      try {
        await onSaved();
      } catch {
        setErrorText(t("savedOnThisDeviceRefreshTheLibraryToUpdateThe2"));
      }
    } catch (error) {
      // A native validation rejection has a known outcome; response decoding failures remain retryable with the same UUID.
      if (z.string().safeParse(error).success && error !== "commit_uncertain") {
        unresolved.current = null;
        setUncertain(false);
      } else {
        setUncertain(true);
      }
      setErrorText(organizationError(error));
      await recover(z.string().safeParse(error).data ?? null, action);
    }
    flight.current = false;
    setBusy(false);
  };
  const submitName = () => {
    const target = id ?? crypto.randomUUID();
    if (entity === "collection") {
      return save({
        kind: creating ? "collection.create" : "collection.rename",
        id: target,
        name,
      });
    }
    return save({
      kind: creating ? "tag.create" : "tag.rename",
      id: target,
      name,
    });
  };
  const limit = entity === "collection" ? 200 : 1000;
  let saveLabel = creating
    ? t("createValue", [t(entity === "collection" ? "collection" : "tag")])
    : t("saveName");
  if (busy) {
    saveLabel = t("saving");
  }
  if (uncertain) {
    saveLabel = t("retrySave");
  }
  const edit = (entry: OrganizationEdit) => {
    editRevision.current = snapshot.localRevision;
    setDraft({
      name: entry.name,
      baseline: entry.name,
      id: entry.id,
      replaces: entry.replaces ?? null,
      creating: entry.creating ?? false,
    });
    input.current?.focus();
  };
  return {
    dialog,
    input,
    tab,
    setTab,
    name,
    id,
    replaces,
    creating,
    busy,
    uncertain,
    message,
    errorText,
    discard,
    setDiscard,
    confirmation,
    setConfirmation,
    result,
    setResult,
    entity,
    entries,
    dirty,
    clear,
    close,
    prepare,
    save,
    submitName,
    limit,
    saveLabel,
    setName,
    setDraft,
    edit,
  };
};
