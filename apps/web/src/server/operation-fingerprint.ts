import { createHash } from "node:crypto";

import { trimOrganizationName } from "@pr0/api-contract/organization";
import type { MutationEnvelope, PromptText } from "@pr0/api-contract/prompts";
import { promptStateFields } from "@pr0/api-contract/prompts";

// Fixed-order canonical v1 payload; preserve existing prompt fingerprints for replay.
export const operationFingerprint = (
  envelope: MutationEnvelope,
  operation: MutationEnvelope["operations"][number],
  desired: PromptText | null
) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        1,
        envelope.protocolVersion,
        envelope.instanceId,
        envelope.accountId,
        envelope.epoch,
        envelope.installationId,
        operation.operationId,
        operation.kind,
        "collectionId" in operation
          ? operation.collectionId
          : operation.promptId,
        operation.baseRevision,
        operation.dependsOn,
        ...("collectionId" in operation
          ? [trimOrganizationName(operation.name)]
          : []),
        ...(desired
          ? [desired.title, desired.description, desired.content]
          : []),
        ...("desired" in operation &&
        operation.desired.collectionId !== undefined
          ? [operation.desired.collectionId]
          : []),
        ...(operation.kind === "prompt.duplicate" ? [operation.sourceId] : []),
        ...(operation.kind === "prompt.update"
          ? [
              operation.base.title,
              operation.base.description,
              operation.base.content,
              operation.changedFields,
              ...(operation.base.collectionId === undefined
                ? []
                : [operation.base.collectionId]),
              ...(promptStateFields.some(
                (field) => operation.desired[field] !== undefined
              )
                ? [
                    operation.base.favorite ?? null,
                    operation.base.archived ?? null,
                    operation.desired.favorite ?? null,
                    operation.desired.archived ?? null,
                  ]
                : []),
            ]
          : []),
      ])
    )
    .digest("hex");
