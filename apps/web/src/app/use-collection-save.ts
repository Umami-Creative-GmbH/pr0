"use client";

import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import { organizationNameSchema } from "@pr0/api-contract/organization";
import type { MutationEnvelope } from "@pr0/api-contract/prompts";
import { useRef, useState } from "react";

export const useCollectionSave = (
  library: PrivateLibrary,
  onAccepted: () => void
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
  const save = async (name: string, collectionId: string | null) => {
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
        operations: [
          {
            kind: collectionId ? "collection.rename" : "collection.create",
            operationId: crypto.randomUUID(),
            collectionId: collectionId ?? crypto.randomUUID(),
            name,
            baseRevision: library.revision,
            dependsOn: [],
          },
        ],
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
      if (result?.status === "accepted" && "collectionId" in result) {
        pending.current = null;
        setState({
          busy: false,
          uncertain: false,
          message: "Saved to server.",
          error: "",
        });
        onAccepted();
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
