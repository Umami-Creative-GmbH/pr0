import { createHash } from "node:crypto";

import { trimOrganizationName } from "@pr0/api-contract/organization";
import type { MutationEnvelope, PromptText } from "@pr0/api-contract/prompts";
import { promptStateFields } from "@pr0/api-contract/prompts";

const operationEntityId = (
  operation: MutationEnvelope["operations"][number]
) => {
  if ("tagId" in operation) {
    return operation.tagId;
  }
  if ("collectionId" in operation) {
    return operation.collectionId;
  }
  return operation.promptId;
};
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
        operationEntityId(operation),
        operation.baseRevision,
        operation.dependsOn,
        ...("noticeId" in operation ? [operation.noticeId] : []),
        ...(operation.kind === "prompt.use" ? [operation.occurredAt] : []),
        ...(operation.kind === "prompt.tags"
          ? [operation.add, operation.remove]
          : []),
        ...(operation.kind === "tag.merge" ? [operation.targetId] : []),
        ...("name" in operation ? [trimOrganizationName(operation.name)] : []),
        ...(desired
          ? [desired.title, desired.description, desired.content]
          : []),
        ...("desired" in operation &&
        operation.desired.collectionId !== undefined
          ? [operation.desired.collectionId]
          : []),
        ...(operation.kind === "prompt.duplicate" ? [operation.sourceId] : []),
        ...((operation.kind === "prompt.create" ||
          operation.kind === "prompt.duplicate") &&
        operation.desired.tagIds !== undefined
          ? [operation.desired.tagIds]
          : []),
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
