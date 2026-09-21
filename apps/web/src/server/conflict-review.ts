// oxlint-disable react-doctor/server-sequential-independent-await -- Review and receipt commit under the owning library's serialization lock.
import "server-only";
import { mutationReceiptSchema } from "@pr0/api-contract/prompts";
import type {
  MutationEnvelope,
  ReviewConflict,
  ReviewOrganization,
} from "@pr0/api-contract/prompts";
import type { SQL } from "bun";

import { PromptFailureError } from "./prompt-errors";

export const reviewConflict = async (
  sql: SQL,
  envelope: MutationEnvelope,
  operation: ReviewConflict | ReviewOrganization,
  hash: string
) => {
  const { instanceId, accountId } = envelope;
  const [notice] =
    operation.kind === "conflict.review"
      ? await sql`SELECT id FROM conflict_notice WHERE instance_id=${instanceId} AND account_id=${accountId} AND id=${operation.noticeId} AND copy_id=${operation.promptId} UNION ALL SELECT conflict_notice_id AS id FROM library_operation WHERE instance_id=${instanceId} AND account_id=${accountId} AND conflict_notice_id=${operation.noticeId} AND conflict_copy_id=${operation.promptId} LIMIT 1`
      : await sql`SELECT operation_id FROM library_operation WHERE instance_id=${instanceId} AND account_id=${accountId} AND operation_id=${operation.noticeId} AND prompt_id=${operation.promptId} AND organization_notice IS NOT NULL`;
  if (!notice) {
    throw new PromptFailureError(
      {
        code: "not_found",
        message: "This notice is not available in your library.",
        retryable: false,
      },
      404
    );
  }
  const [accepted] =
    await sql`UPDATE library SET revision=revision+1 WHERE instance_id=${instanceId} AND account_id=${accountId} RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
  if (operation.kind === "conflict.review") {
    await sql`UPDATE conflict_notice SET reviewed_at=coalesce(reviewed_at,${accepted.accepted_at}) WHERE instance_id=${instanceId} AND account_id=${accountId} AND id=${operation.noticeId}`;
  }
  await sql`INSERT INTO library_operation(instance_id,account_id,operation_id,epoch,installation_id,canonical_version,request_hash,kind,prompt_id,revision,accepted_at,conflict_notice_id)
    VALUES (${instanceId},${accountId},${operation.operationId},${envelope.epoch},${envelope.installationId},1,${hash},${operation.kind},${operation.promptId},${accepted.revision},${accepted.accepted_at},${operation.kind === "organization.review" ? operation.noticeId : null})`;
  await sql`INSERT INTO library_change(instance_id,account_id,revision,operation_id,kind,prompt_id,accepted_at)
    VALUES (${instanceId},${accountId},${accepted.revision},${operation.operationId},${operation.kind},${operation.promptId},${accepted.accepted_at})`;
  return mutationReceiptSchema.parse({
    status: "accepted",
    operationId: operation.operationId,
    promptId: operation.promptId,
    revision: accepted.revision,
    acceptedAt: accepted.accepted_at.toISOString(),
  });
};
