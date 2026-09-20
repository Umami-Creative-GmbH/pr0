// oxlint-disable react-doctor/server-sequential-independent-await -- Reads and writes depend on the same locked library transaction.
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  mutationReceiptSchema,
  promptLimits,
  promptPageSchema,
  promptSchema,
  promptTextSchema,
  trimPromptText,
  utf8Bytes,
} from "@pr0/api-contract/prompts";
import type { CreatePrompt, MutationEnvelope } from "@pr0/api-contract/prompts";
import type { TransactionSQL } from "bun";
import { z } from "zod";

import { lockAccount } from "./browser-proof";
import type { BrowserAccount } from "./browser-proof";
import { configuration } from "./config";
import { database } from "./database";
import { invalidPromptRequest, PromptFailureError } from "./prompt-errors";

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
});
const receiptFrom = (row: z.infer<typeof receiptColumns>) =>
  mutationReceiptSchema.parse({
    status: "accepted",
    operationId: row.operation_id,
    promptId: row.prompt_id,
    revision: row.revision,
    acceptedAt: row.accepted_at.toISOString(),
  });
export const createPrompt = (
  browser: BrowserAccount,
  envelope: MutationEnvelope,
  operation: CreatePrompt
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
        ])
      )
      .digest("hex");
    const [existing] =
      await tx`SELECT operation_id, prompt_id, revision::text, accepted_at, request_hash FROM library_operation
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
        await tx`SELECT count(*)::int AS count FROM library_operation WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND operation_id IN ${tx(operation.dependsOn)}`;
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
    const used =
      await tx`SELECT prompt_id FROM library_operation WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND prompt_id = ${operation.promptId}`;
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
      await tx`UPDATE library SET revision = revision + 1, prompt_count = prompt_count + 1, text_bytes = text_bytes + ${bytes}
    WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} RETURNING revision::text, date_trunc('milliseconds', clock_timestamp()) AS accepted_at`;
    const revision = String(updated.revision);
    const acceptedAt: Date = updated.accepted_at;
    await tx`INSERT INTO prompt(instance_id, account_id, id, title, description, content, revision, title_revision, description_revision, content_revision, created_at, modified_at)
    VALUES (${library.instance_id}, ${browser.accountId}, ${operation.promptId}, ${desired.title}, ${desired.description}, ${desired.content}, ${revision}, ${revision}, ${revision}, ${revision}, ${acceptedAt}, ${acceptedAt})`;
    await tx`INSERT INTO library_operation(instance_id, account_id, operation_id, epoch, installation_id, canonical_version, request_hash, kind, prompt_id, revision, accepted_at)
    VALUES (${library.instance_id}, ${browser.accountId}, ${operation.operationId}, ${envelope.epoch}, ${envelope.installationId}, 1, ${hash}, ${operation.kind}, ${operation.promptId}, ${revision}, ${acceptedAt})`;
    await tx`INSERT INTO library_change(instance_id, account_id, revision, operation_id, kind, prompt_id, accepted_at)
    VALUES (${library.instance_id}, ${browser.accountId}, ${revision}, ${operation.operationId}, ${operation.kind}, ${operation.promptId}, ${acceptedAt})`;
    return mutationReceiptSchema.parse({
      status: "accepted",
      operationId: operation.operationId,
      promptId: operation.promptId,
      revision,
      acceptedAt: acceptedAt.toISOString(),
    });
  });

const cursorSchema = z.strictObject({
  account: z.string(),
  instance: z.string(),
  epoch: z.string(),
  version: z.literal(1),
  revision: z.string(),
  after: z.string().regex(/^\d+$/u),
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
    WHERE instance_id = ${library.instance_id} AND account_id = ${browser.accountId} AND revision < ${page?.after ?? "9223372036854775807"}::bigint
    ORDER BY prompt.revision DESC, id LIMIT ${limit + 1}`;
    const visible = rows.slice(0, limit);
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const payload = Buffer.from(
        JSON.stringify({
          account: browser.accountId,
          instance: library.instance_id,
          epoch: library.recovery_epoch,
          version: 1,
          revision: library.revision,
          after: visible.at(-1)?.revision,
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
    >`SELECT id, title, description, content, revision::text, created_at, modified_at FROM prompt
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
    });
  });
