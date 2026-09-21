"use client";

import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { organizationNameSchema } from "@pr0/api-contract/organization";
import type { MutationEnvelope } from "@pr0/api-contract/prompts";
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
  return `Tag “${existing.name}” already exists. No prompts were assigned.`;
};
export const useOrganizationNameSave = (
  library: PrivateLibrary,
  onAccepted: () => void | Promise<void>,
  entity: "collection" | "tag" = "collection"
) => {
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
        message: "Not saved.",
        error: parsed.error.issues[0]?.message ?? "Check the name.",
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
    setState({ busy: true, uncertain: false, message: "Saving…", error: "" });
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
        let message = "Saved to server.";
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
          message: `Not saved. ${result.error.message}`,
          error: result.error.fields?.name ?? "",
        });
      }
    } catch {
      setState({
        busy: false,
        uncertain: true,
        message:
          "The server did not confirm saving. Keep this dialog open and Retry to confirm the original request.",
        error: "",
      });
    }
    inFlight.current = false;
    return accepted;
  };
  return { state, save };
};
