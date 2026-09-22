"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { organizationNameSchema } from "@pr0/api-contract/organization";
import type { MutationEnvelope } from "@pr0/api-contract/prompts";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
import { localizeMessage } from "@pr0/ui/lib/message-localization";
import { useRef, useState } from "react";

import { useReportAttention } from "./library-attention";

const nameOperation = (
  entity: "collection" | "tag",
  id: string | null,
  name: string,
  revision: string
): MutationEnvelope["operations"][number] => {
  const common = {
    operationId: crypto.randomUUID(),
    name,
    baseRevision: revision,
    dependsOn: [],
  };
  if (entity === "tag") {
    return {
      ...common,
      kind: id ? "tag.rename" : "tag.create",
      tagId: id ?? crypto.randomUUID(),
    };
  }
  return {
    ...common,
    kind: id ? "collection.rename" : "collection.create",
    collectionId: id ?? crypto.randomUUID(),
  };
};
const existingTagMessage = async (
  client: ReturnType<typeof useApiClient>,
  library: PrivateLibrary,
  resolvedTagId: string
) => {
  const snapshot = await client.getOrganization(AbortSignal.timeout(30_000), {
    accountId: library.account.id,
    instanceId: library.instance.id,
  });
  const existing = snapshot.tags.find((tag) => tag.id === resolvedTagId);
  if (!existing) {
    throw new Error("The resolved tag is missing from the library snapshot.");
  }
  return translate("tagValueAlreadyExistsNoPromptsWereAssigned", [
    existing.name,
  ]);
};
export const useOrganizationNameSave = (
  library: PrivateLibrary,
  onAccepted: () => void | Promise<void>,
  entity: "collection" | "tag" = "collection"
) => {
  const t = useTranslations();

  const client = useApiClient();
  const pending = useRef<MutationEnvelope | null>(null);
  const inFlight = useRef(false);
  const [state, setState] = useState({
    busy: false,
    uncertain: false,
    message: "",
    error: "",
  });
  useReportAttention(state.error, "collection-name-error");
  const save = async (name: string, entityId: string | null) => {
    if (inFlight.current) {
      return false;
    }
    const parsed = organizationNameSchema.safeParse(name);
    if (!pending.current && !parsed.success) {
      setState({
        busy: false,
        uncertain: false,
        message: t("notSaved"),
        error: parsed.error.issues[0]?.message ?? t("checkTheName"),
      });
      return false;
    }
    if (!pending.current) {
      pending.current = {
        protocolVersion: 1,
        instanceId: library.instance.id,
        accountId: library.account.id,
        epoch: library.epoch,
        installationId: crypto.randomUUID(),
        operations: [nameOperation(entity, entityId, name, library.revision)],
      };
    }
    inFlight.current = true;
    setState({ busy: true, uncertain: false, message: t("saving"), error: "" });
    let accepted = false;
    try {
      const response = await client.mutatePrompts(
        pending.current,
        AbortSignal.timeout(30_000)
      );
      const [result] = response.results;
      if (
        result?.status === "accepted" &&
        ("collectionId" in result || "tagId" in result)
      ) {
        let message = t("savedToServer");
        if ("tagId" in result && result.outcome === "existing") {
          message = await existingTagMessage(
            client,
            library,
            result.resolvedTagId
          );
        }
        await onAccepted();
        pending.current = null;
        setState({
          busy: false,
          uncertain: false,
          message,
          error: "",
        });
        accepted = true;
      }
      if (result?.status === "rejected") {
        const uncertain = ![
          "validation_failed",
          "quota_exceeded",
          "name_conflict",
          "identity_unavailable",
          "not_found",
          "dependency_blocked",
        ].includes(result.error.code);
        if (!uncertain) {
          pending.current = null;
        }
        setState({
          busy: false,
          uncertain,
          message: t("notSavedValue", [localizeMessage(result.error.message)]),
          error: result.error.fields?.name ?? "",
        });
      }
    } catch {
      setState({
        busy: false,
        uncertain: true,
        message: t("theServerDidNotConfirmSavingKeepThisDialogOpen"),
        error: "",
      });
    }
    inFlight.current = false;
    return accepted;
  };
  return { state, save };
};
