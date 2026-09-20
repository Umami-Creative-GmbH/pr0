// oxlint-disable react-doctor/server-sequential-independent-await -- The copy and notice belong to the caller's serialized transaction.
import "server-only";
import { conflictCopyTitle, utf8Bytes } from "@pr0/api-contract/prompts";
import type { PromptText } from "@pr0/api-contract/prompts";
import type { SQL } from "bun";

export const prepareConflictCopy = (source: PromptText) => {
  const title = conflictCopyTitle(source.title);
  return {
    id: crypto.randomUUID(),
    noticeId: crypto.randomUUID(),
    title,
    source,
    bytes:
      utf8Bytes(title) +
      utf8Bytes(source.title) +
      utf8Bytes(source.description) +
      utf8Bytes(source.content),
  };
};

export const persistConflictCopy = async ({
  sql,
  instanceId,
  accountId,
  originalId,
  revision,
  acceptedAt,
  copy,
}: {
  sql: SQL;
  instanceId: string;
  accountId: string;
  originalId: string;
  revision: string;
  acceptedAt: Date;
  copy: ReturnType<typeof prepareConflictCopy>;
}) => {
  await sql`INSERT INTO prompt(instance_id, account_id, id, title, description, content, revision, title_revision, description_revision, content_revision, created_at, modified_at)
    VALUES (${instanceId}, ${accountId}, ${copy.id}, ${copy.title}, ${copy.source.description}, ${copy.source.content}, ${revision}, ${revision}, ${revision}, ${revision}, ${acceptedAt}, ${acceptedAt})`;
  await sql`INSERT INTO conflict_notice(instance_id, account_id, id, original_id, copy_id, source_title, revision, created_at)
    VALUES (${instanceId}, ${accountId}, ${copy.noticeId}, ${originalId}, ${copy.id}, ${copy.source.title}, ${revision}, ${acceptedAt})`;
};
