// oxlint-disable react-doctor/server-sequential-independent-await -- Reads and writes depend on the same locked library transaction.
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  mutationReceiptSchema,
  promptLimits,
  promptPageSchema,
  promptSchema,
  promptTextSchema,
  promptTextFields,
  conflictCopyTitle,
  conflictPageSchema,
  trimPromptText,
  utf8Bytes,
} from "@pr0/api-contract/prompts";
import type {
  MutationEnvelope,
  UpdatePrompt,
  PromptText,
} from "@pr0/api-contract/prompts";
import type { TransactionSQL, SQL } from "bun";
import { z } from "zod";

import { lockAccount } from "./browser-proof";
import type { BrowserAccount } from "./browser-proof";
import { configuration } from "./config";
import { database } from "./database";
import {
  invalidPromptRequest,
  PromptFailureError,
  promptFailure,
} from "./prompt-errors";

interface LibraryRow {
  instance_id: string;
  recovery_epoch: string;
  revision: string;
  prompt_count: number;
  text_bytes: string;
}
const lockLibrary = async (tx: TransactionSQL, browser: BrowserAccount) => {
  await lockAccount(tx, browser);
  const [library] = await tx<
    LibraryRow[]
  >`SELECT l.instance_id, i.recovery_epoch, l.revision::text, l.prompt_count, l.text_bytes::text
    FROM library l JOIN instance i ON i.id = l.instance_id WHERE l.account_id = ${browser.accountId} FOR UPDATE OF l`;
  if (!library) {
    throw new Error("Library unavailable");
  }
  return library;
};
const receiptColumns = z.object({
  operation_id: z.string(),
  prompt_id: z.string(),
  revision: z.string(),
  accepted_at: z.date(),
  conflict_copy_id: z.string().nullable().optional(),
  conflict_notice_id: z.string().nullable().optional(),
});
const receiptFrom = (row: z.infer<typeof receiptColumns>) =>
  mutationReceiptSchema.parse({
    status: "accepted",
    operationId: row.operation_id,
    promptId: row.prompt_id,
    revision: row.revision,
    acceptedAt: row.accepted_at.toISOString(),
    conflict: row.conflict_copy_id
      ? {
          copyId: row.conflict_copy_id,
          noticeId: row.conflict_notice_id,
        }
      : undefined,
  });
const applyPromptUpdate = async ({
  savepoint,
  browser,
  library,
  envelope,
  operation,
  desired,
  hash,
}: {
  savepoint: SQL;
  browser: BrowserAccount;
  library: LibraryRow;
  envelope: MutationEnvelope;
  operation: UpdatePrompt;
  desired: PromptText;
  hash: string;
}) => {
  const [current] =
    await savepoint`SELECT title, description, content, revision::text, title_revision::text, description_revision::text, content_revision::text FROM prompt
        WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND id = ${operation.promptId}`;
  if (!current) {
    throw new PromptFailureError(
      {
        code: "not_found",
        message: "This prompt is not available in your library.",
        retryable: false,
      },
      404
    );
  }
  const base = {
    title: trimPromptText(operation.base.title),
    description: trimPromptText(operation.base.description),
    content: operation.base.content,
  };
  const changedFields = new Set(operation.changedFields);
  if (
    !promptTextSchema.safeParse(base).success ||
    new Set(operation.changedFields).size !== operation.changedFields.length ||
    promptTextFields.some(
      (field) => (base[field] !== desired[field]) !== changedFields.has(field)
    )
  ) {
    throw invalidPromptRequest();
  }
  const next = {
    title: current.title,
    description: current.description,
    content: current.content,
  };
  let conflict = false;
  for (const field of operation.changedFields) {
    if (current[field] === desired[field]) {
      continue;
    }
    if (current[field] === base[field]) {
      next[field] = desired[field];
    } else {
      conflict = true;
    }
  }
  const changed = promptTextFields.some(
    (field) => next[field] !== current[field]
  );
  const copyId = conflict ? crypto.randomUUID() : null;
  const noticeId = conflict ? crypto.randomUUID() : null;
  const copyTitle = conflictCopyTitle(desired.title);
  const copyBytes = conflict
    ? utf8Bytes(copyTitle) +
      utf8Bytes(desired.description) +
      utf8Bytes(desired.content) +
      utf8Bytes(desired.title)
    : 0;
  const delta = promptTextFields.reduce(
    (sum, field) => sum + utf8Bytes(next[field]) - utf8Bytes(current[field]),
    copyBytes
  );
  const countExceeded =
    conflict && library.prompt_count >= promptLimits.promptCount;
  if (
    countExceeded ||
    Number(library.text_bytes) + delta > promptLimits.libraryBytes
  ) {
    throw new PromptFailureError({
      code: "quota_exceeded",
      message: `This edit cannot be preserved because your library has reached its ${countExceeded ? "10,000 prompt" : "100 MiB text"} capacity. Your server prompt is unchanged. Keep this tab open, correct or copy your draft, and retry. Archiving does not free capacity.`,
      resource: countExceeded ? "promptCount" : "textBytes",
      usage: {
        promptCount: library.prompt_count,
        textBytes: Number(library.text_bytes),
      },
      retryable: true,
    });
  }
  const [accepted] =
    await savepoint`UPDATE library SET revision = revision + 1, text_bytes = text_bytes + ${delta}, prompt_count = prompt_count + ${conflict ? 1 : 0}
        WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
  if (changed) {
    await savepoint`UPDATE prompt SET title = ${next.title}, description = ${next.description}, content = ${next.content},
          title_revision = CASE WHEN title <> ${next.title} THEN ${accepted.revision}::bigint ELSE title_revision END,
          description_revision = CASE WHEN description <> ${next.description} THEN ${accepted.revision}::bigint ELSE description_revision END,
          content_revision = CASE WHEN content <> ${next.content} THEN ${accepted.revision}::bigint ELSE content_revision END,
          revision = ${accepted.revision}, modified_at = GREATEST(${accepted.accepted_at}, modified_at + interval '1 millisecond')
          WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND id = ${operation.promptId}`;
  }
  if (conflict) {
    await savepoint`INSERT INTO prompt(instance_id, account_id, id, title, description, content, revision, title_revision, description_revision, content_revision, created_at, modified_at)
          VALUES (${library.instance_id}, ${browser.accountId}, ${copyId}, ${copyTitle}, ${desired.description}, ${desired.content}, ${accepted.revision}, ${accepted.revision}, ${accepted.revision}, ${accepted.revision}, ${accepted.accepted_at}, ${accepted.accepted_at})`;
    await savepoint`INSERT INTO conflict_notice(instance_id, account_id, id, original_id, copy_id, source_title, revision, created_at)
          VALUES (${library.instance_id}, ${browser.accountId}, ${noticeId}, ${operation.promptId}, ${copyId}, ${desired.title}, ${accepted.revision}, ${accepted.accepted_at})`;
  }
  await savepoint`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, prompt_id, revision, accepted_at, conflict_copy_id, conflict_notice_id)
        VALUES (${library.instance_id}, ${browser.accountId}, ${operation.operationId}, ${envelope.epoch}, ${envelope.installationId}, 1, ${hash}, ${operation.kind}, ${operation.promptId}, ${accepted.revision}, ${accepted.accepted_at}, ${copyId}, ${noticeId})`;
  await savepoint`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, prompt_id, accepted_at)
        VALUES (${library.instance_id}, ${browser.accountId}, ${accepted.revision}, ${operation.operationId}, ${operation.kind}, ${operation.promptId}, ${accepted.accepted_at})`;
  return receiptFrom(
    receiptColumns.parse({
      ...accepted,
      operation_id: operation.operationId,
      prompt_id: operation.promptId,
      conflict_copy_id: copyId,
      conflict_notice_id: noticeId,
    })
  );
};
export const mutatePrompt = (
  browser: BrowserAccount,
  envelope: MutationEnvelope,
  operation: MutationEnvelope["operations"][number]
) =>
  database().begin(async (tx) => {
    const library = await lockLibrary(tx, browser);
    if (
      envelope.accountId !== browser.accountId ||
      envelope.instanceId !== library.instance_id
    ) {
      throw new PromptFailureError(
        {
          code: "forbidden",
          message: "This operation belongs to a different library.",
          retryable: false,
        },
        403
      );
    }
    if (envelope.epoch !== library.recovery_epoch) {
      throw new PromptFailureError(
        {
          code: "snapshot_required",
          message:
            "This instance was recovered. Refresh library information before retrying; retain your text.",
          retryable: false,
        },
        409
      );
    }
    const desired = {
      title: trimPromptText(operation.desired.title),
      description: trimPromptText(operation.desired.description),
      content: operation.desired.content,
    };
    const hash = createHash("sha256")
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
          operation.promptId,
          operation.baseRevision,
          operation.dependsOn,
          desired.title,
          desired.description,
          desired.content,
          ...(operation.kind === "prompt.update"
            ? [
                operation.base.title,
                operation.base.description,
                operation.base.content,
                operation.changedFields,
              ]
            : []),
        ])
      )
      .digest("hex");
    const [existing] =
      await tx`SELECT operation_id, prompt_id, revision::text, accepted_at, request_hash, conflict_copy_id, conflict_notice_id FROM library_operation
    WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND operation_id = ${operation.operationId}`;
    if (existing) {
      if (existing.request_hash !== hash) {
        throw new PromptFailureError(
          {
            code: "operation_identity_reused",
            message:
              "This operation identity was already used for different content.",
            retryable: false,
          },
          409
        );
      }
      return receiptFrom(receiptColumns.parse(existing));
    }
    const [attempt] =
      await tx`SELECT request_hash FROM library_operation_attempt WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND operation_id = ${operation.operationId}`;
    if (attempt && attempt.request_hash !== hash) {
      throw new PromptFailureError(
        {
          code: "operation_identity_reused",
          message:
            "This operation identity was already used for different content.",
          retryable: false,
        },
        409
      );
    }
    await tx`INSERT INTO library_operation_attempt(instance_id, account_id, operation_id, request_hash)
      VALUES (${library.instance_id}, ${browser.accountId}, ${operation.operationId}, ${hash}) ON CONFLICT DO NOTHING`;
    try {
      return await tx.savepoint(async (savepoint) => {
        const parsed = promptTextSchema.safeParse(operation.desired);
        if (!parsed.success) {
          const fields = Object.fromEntries(
            parsed.error.issues.map((issue) => [
              String(issue.path[0]),
              issue.message,
            ])
          );
          throw new PromptFailureError({
            code: "validation_failed",
            message: "Correct the highlighted prompt fields.",
            retryable: false,
            fields,
          });
        }
        if (BigInt(operation.baseRevision) > BigInt(library.revision)) {
          throw invalidPromptRequest();
        }
        if (operation.dependsOn.length) {
          const [dependencies] =
            await savepoint`SELECT count(*)::int AS count FROM library_operation WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND operation_id IN ${savepoint(operation.dependsOn)}`;
          if (dependencies.count !== new Set(operation.dependsOn).size) {
            throw new PromptFailureError(
              {
                code: "dependency_blocked",
                message: "A required earlier operation has not been accepted.",
                retryable: true,
              },
              409
            );
          }
        }
        if (operation.kind === "prompt.update") {
          return applyPromptUpdate({
            savepoint,
            browser,
            library,
            envelope,
            operation,
            desired,
            hash,
          });
        }
        const used =
          await savepoint`SELECT prompt_id FROM library_operation WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND (prompt_id = ${operation.promptId} OR conflict_copy_id = ${operation.promptId})`;
        if (used.length) {
          throw new PromptFailureError(
            {
              code: "identity_unavailable",
              message: "This prompt identity has already been used.",
              retryable: false,
            },
            409
          );
        }
        const bytes =
          utf8Bytes(desired.title) +
          utf8Bytes(desired.description) +
          utf8Bytes(desired.content);
        const usage = {
          promptCount: library.prompt_count,
          textBytes: Number(library.text_bytes),
        };
        const resource =
          usage.promptCount >= promptLimits.promptCount
            ? "promptCount"
            : "textBytes";
        if (
          usage.promptCount >= promptLimits.promptCount ||
          usage.textBytes + bytes > promptLimits.libraryBytes
        ) {
          throw new PromptFailureError({
            code: "quota_exceeded",
            message:
              resource === "promptCount"
                ? "Your library has reached 10,000 prompts. Archiving does not free capacity."
                : "This prompt would exceed the library's 100 MiB text capacity. Archiving does not free capacity.",
            retryable: true,
            resource,
            usage,
          });
        }
        const [updated] =
          await savepoint`UPDATE library SET revision = revision + 1, prompt_count = prompt_count + 1, text_bytes = text_bytes + ${bytes}
    WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
        const revision = String(updated.revision);
        const acceptedAt: Date = updated.accepted_at;
        await savepoint`INSERT INTO prompt(instance_id, account_id, id, title, description, content, revision, title_revision, description_revision, content_revision, created_at, modified_at)
    VALUES (${library.instance_id}, ${browser.accountId}, ${operation.promptId}, ${desired.title}, ${desired.description}, ${desired.content}, ${revision}, ${revision}, ${revision}, ${revision}, ${acceptedAt}, ${acceptedAt})`;
        await savepoint`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, prompt_id, revision, accepted_at)
    VALUES (${library.instance_id}, ${browser.accountId}, ${operation.operationId}, ${envelope.epoch}, ${envelope.installationId}, 1, ${hash}, ${operation.kind}, ${operation.promptId}, ${revision}, ${acceptedAt})`;
        await savepoint`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, prompt_id, accepted_at)
    VALUES (${library.instance_id}, ${browser.accountId}, ${revision}, ${operation.operationId}, ${operation.kind}, ${operation.promptId}, ${acceptedAt})`;
        return mutationReceiptSchema.parse({
          status: "accepted",
          operationId: operation.operationId,
          promptId: operation.promptId,
          revision,
          acceptedAt: acceptedAt.toISOString(),
        });
      });
    } catch (error) {
      return {
        status: "rejected" as const,
        error: {
          ...promptFailure(
            error instanceof Error ? error : new Error("Mutation failed")
          ).detail,
          operationId: operation.operationId,
        },
      };
    }
  });

const cursorSchema = z.strictObject({
  account: z.string(),
  instance: z.string(),
  epoch: z.string(),
  version: z.literal(2),
  kind: z.enum(["prompts", "conflicts"]),
  revision: z.string(),
  after: z.string().regex(/^\d+$/u),
  afterId: z.uuid(),
  limit: z.number(),
});
const signature = (payload: string) =>
  createHmac("sha256", configuration().authSecret)
    .update(`prompt-page-v1:${payload}`)
    .digest("base64url");
const readCursor = (cursor: string) => {
  const [payload = "", supplied = ""] = cursor.split(".");
  const expected = signature(payload);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    throw invalidPromptRequest();
  }
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"))
    );
  } catch {
    throw invalidPromptRequest();
  }
};
interface PromptRow {
  id: string;
  title: string;
  description: string;
  content?: string;
  revision: string;
  created_at: Date;
  modified_at: Date;
  favorite: boolean;
  archived: boolean;
  use_count: number;
  last_used_at: Date | null;
}
const summaryFrom = (row: PromptRow) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  revision: row.revision,
  createdAt: row.created_at.toISOString(),
  modifiedAt: row.modified_at.toISOString(),
});
export const listPrompts = (
  browser: BrowserAccount,
  limit: number,
  cursor?: string
) =>
  database().begin(async (tx) => {
    const library = await lockLibrary(tx, browser);
    const page = cursor ? readCursor(cursor) : undefined;
    if (
      page &&
      (page.account !== browser.accountId ||
        page.instance !== library.instance_id ||
        page.epoch !== library.recovery_epoch ||
        page.kind !== "prompts" ||
        page.limit !== limit)
    ) {
      throw invalidPromptRequest();
    }
    if (page && page.revision !== library.revision) {
      throw new PromptFailureError(
        {
          code: "results_changed",
          message: "Your library changed. Refresh the list to continue.",
          retryable: true,
        },
        409
      );
    }
    const rows = await tx<
      PromptRow[]
    >`SELECT id, title, description, revision::text, created_at, modified_at FROM prompt
    WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId}
      AND (revision < ${page?.after ?? "9223372036854775807"}::bigint OR (revision = ${page?.after ?? "9223372036854775807"}::bigint AND id > ${page?.afterId ?? "00000000-0000-0000-0000-000000000000"}::uuid))
    ORDER BY prompt.revision DESC, id LIMIT ${limit + 1}`;
    const visible = rows.slice(0, limit);
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const payload = Buffer.from(
        JSON.stringify({
          account: browser.accountId,
          instance: library.instance_id,
          epoch: library.recovery_epoch,
          version: 2,
          kind: "prompts",
          revision: library.revision,
          after: visible.at(-1)?.revision,
          afterId: visible.at(-1)?.id,
          limit,
        })
      ).toString("base64url");
      nextCursor = `${payload}.${signature(payload)}`;
    }
    return promptPageSchema.parse({
      instanceId: library.instance_id,
      accountId: browser.accountId,
      revision: library.revision,
      prompts: visible.map(summaryFrom),
      nextCursor,
      usage: {
        promptCount: library.prompt_count,
        textBytes: Number(library.text_bytes),
      },
    });
  });
export const getPrompt = (browser: BrowserAccount, id: string) =>
  database().begin(async (tx) => {
    const library = await lockLibrary(tx, browser);
    const [row] = await tx<
      PromptRow[]
    >`SELECT id, title, description, content, revision::text, created_at, modified_at, favorite, archived, use_count, last_used_at FROM prompt
    WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND id = ${id}`;
    if (!row) {
      throw new PromptFailureError(
        {
          code: "not_found",
          message: "This prompt is not available in your library.",
          retryable: false,
        },
        404
      );
    }
    return promptSchema.parse({
      ...summaryFrom(row),
      content: row.content,
      instanceId: library.instance_id,
      accountId: browser.accountId,
      favorite: row.favorite,
      archived: row.archived,
      useCount: row.use_count,
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
    });
  });

export const listConflicts = (
  browser: BrowserAccount,
  limit: number,
  cursor?: string
) =>
  database().begin(async (tx) => {
    const library = await lockLibrary(tx, browser);
    const page = cursor ? readCursor(cursor) : undefined;
    if (
      page &&
      (page.account !== browser.accountId ||
        page.instance !== library.instance_id ||
        page.epoch !== library.recovery_epoch ||
        page.kind !== "conflicts" ||
        page.limit !== limit)
    ) {
      throw invalidPromptRequest();
    }
    if (page && page.revision !== library.revision) {
      throw new PromptFailureError(
        {
          code: "results_changed",
          message: "Your library changed. Refresh conflicts to continue.",
          retryable: true,
        },
        409
      );
    }
    const rows = await tx<
      {
        id: string;
        original_id: string;
        copy_id: string;
        source_title: string;
        revision: string;
        created_at: Date;
      }[]
    >`SELECT id, original_id, copy_id, source_title, revision::text, created_at FROM conflict_notice
    WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND reviewed_at IS NULL
      AND (revision < ${page?.after ?? "9223372036854775807"}::bigint OR (revision = ${page?.after ?? "9223372036854775807"}::bigint AND id > ${page?.afterId ?? "00000000-0000-0000-0000-000000000000"}::uuid))
    ORDER BY conflict_notice.revision DESC, id LIMIT ${limit + 1}`;
    const visible = rows.slice(0, limit);
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const payload = Buffer.from(
        JSON.stringify({
          account: browser.accountId,
          instance: library.instance_id,
          epoch: library.recovery_epoch,
          version: 2,
          kind: "conflicts",
          revision: library.revision,
          after: visible.at(-1)?.revision,
          afterId: visible.at(-1)?.id,
          limit,
        })
      ).toString("base64url");
      nextCursor = `${payload}.${signature(payload)}`;
    }
    return conflictPageSchema.parse({
      instanceId: library.instance_id,
      accountId: browser.accountId,
      nextCursor,
      notices: visible.map((row) => ({
        id: row.id,
        originalId: row.original_id,
        copyId: row.copy_id,
        sourceTitle: row.source_title,
        revision: row.revision,
        createdAt: row.created_at.toISOString(),
      })),
    });
  });
