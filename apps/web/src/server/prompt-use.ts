// oxlint-disable react-doctor/server-sequential-independent-await -- Usage, receipt and projection revision commit in the same locked transaction.
import "server-only";
import { mutationReceiptSchema } from "@pr0/api-contract/prompts";
import type { MutationEnvelope, UsePrompt } from "@pr0/api-contract/prompts";
import type { SQL } from "bun";

import { PromptFailureError } from "./prompt-errors";

export const applyPromptUse = async (
  sql: SQL,
  envelope: MutationEnvelope,
  operation: UsePrompt,
  hash: string
) => {
  const { instanceId, accountId } = envelope;
  const [known] =
    await sql`SELECT id FROM prompt WHERE instance_id=${instanceId} AND account_id=${accountId} AND id=${operation.promptId}
    UNION ALL SELECT prompt_id FROM prompt_deletion WHERE instance_id=${instanceId} AND account_id=${accountId} AND prompt_id=${operation.promptId}`;
  if (!known) {
    throw new PromptFailureError(
      {
        code: "not_found",
        message: "This prompt is not available in your library.",
        retryable: false,
      },
      404
    );
  }
  const [accepted] =
    await sql`UPDATE library SET revision=revision+1 WHERE instance_id=${instanceId} AND account_id=${accountId}
    RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
  const usedAt = new Date(
    Math.min(Date.parse(operation.occurredAt), accepted.accepted_at.getTime())
  );
  await sql`UPDATE prompt SET use_count=use_count+1, last_used_at=GREATEST(last_used_at, ${usedAt}), revision=${accepted.revision}
    WHERE instance_id=${instanceId} AND account_id=${accountId} AND id=${operation.promptId}`;
  await sql`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, prompt_id, revision, accepted_at, used_at)
    VALUES (${instanceId}, ${accountId}, ${operation.operationId}, ${envelope.epoch}, ${envelope.installationId}, 1, ${hash}, ${operation.kind}, ${operation.promptId}, ${accepted.revision}, ${accepted.accepted_at}, ${usedAt})`;
  await sql`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, prompt_id, accepted_at)
    VALUES (${instanceId}, ${accountId}, ${accepted.revision}, ${operation.operationId}, ${operation.kind}, ${operation.promptId}, ${accepted.accepted_at})`;
  return mutationReceiptSchema.parse({
    status: "accepted",
    operationId: operation.operationId,
    promptId: operation.promptId,
    revision: accepted.revision,
    acceptedAt: accepted.accepted_at.toISOString(),
    usedAt: usedAt.toISOString(),
  });
};
