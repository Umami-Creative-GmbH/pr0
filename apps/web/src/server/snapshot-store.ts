// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Bounded keyset batches and page writes share one library-locked materialization transaction.
import "server-only";
import {
  snapshotLimits,
  snapshotManifestSchema,
  snapshotPageRequestSchema,
  snapshotCreateRequestSchema,
  snapshotRecordsSchema,
} from "@pr0/api-contract/snapshots";
import type { SnapshotManifest } from "@pr0/api-contract/snapshots";
import type { TransactionSQL } from "bun";
import { z } from "zod";

import { AccountFailureError } from "./admission";
import { readOrganization } from "./collection-store";
import { database } from "./database";

export const snapshotRequestSchema = z.union([
  snapshotCreateRequestSchema,
  snapshotPageRequestSchema,
]);
const readPage = async (
  tx: TransactionSQL,
  input: z.infer<typeof snapshotPageRequestSchema>,
  manifest: SnapshotManifest | undefined,
  epoch: string
) => {
  if (!manifest || manifest.id !== input.id) {
    throw new AccountFailureError("not_found", 404);
  }
  if (
    Date.parse(manifest.expiresAt) <= Date.now() ||
    manifest.epoch !== epoch
  ) {
    return { expired: true as const };
  }
  const [row] =
    await tx`SELECT payload FROM library_snapshot_page WHERE instance_id=${manifest.instanceId} AND account_id=${manifest.accountId} AND snapshot_id=${input.id} AND page=${input.page}`;
  if (!row) {
    throw new AccountFailureError("not_found", 404);
  }
  return {
    id: input.id,
    page: input.page,
    payload: z.string().parse(row.payload),
  };
};
const reusableSnapshot = (
  prior: SnapshotManifest | undefined,
  epoch: string,
  currentRevision: string,
  minimumRevision?: string
) =>
  prior &&
  Date.parse(prior.expiresAt) > Date.now() &&
  prior.epoch === epoch &&
  BigInt(prior.revision) >= BigInt(minimumRevision ?? "0") &&
  (minimumRevision === undefined || prior.revision === currentRevision)
    ? prior
    : undefined;
export const readSnapshot = (
  accountId: string,
  sessionId: string,
  input: z.infer<typeof snapshotRequestSchema>
) =>
  database().begin(async (tx) => {
    // Account -> session -> library is the same lock order as mutations/deletion.
    const owner =
      await tx`SELECT id FROM "user" WHERE id = ${accountId} AND email_verified AND NOT deletion_pending FOR UPDATE`;
    const active =
      await tx`SELECT id FROM session WHERE id = ${sessionId} AND user_id = ${accountId} AND provenance = 'device' AND expires_at > clock_timestamp() FOR KEY SHARE`;
    if (!owner.length || !active.length) {
      throw new AccountFailureError("unauthenticated", 401);
    }
    const [library] =
      await tx`SELECT l.instance_id, l.revision::text, l.prompt_count, l.text_bytes::text, i.recovery_epoch FROM library l JOIN instance i ON i.id=l.instance_id WHERE l.account_id=${accountId} FOR UPDATE OF l`;
    if (!library) {
      throw new AccountFailureError("unavailable", 503);
    }
    const instanceId: string = library.instance_id;
    const [existing] =
      await tx`SELECT id, manifest, expires_at FROM library_snapshot WHERE instance_id=${instanceId} AND account_id=${accountId}`;
    const prior = existing
      ? snapshotManifestSchema.parse(JSON.parse(existing.manifest))
      : undefined;
    if ("id" in input) {
      return readPage(
        tx,
        snapshotPageRequestSchema.parse(input),
        prior,
        library.recovery_epoch
      );
    }
    const minimumRevision = BigInt(input.minimumRevision ?? "0");
    if (minimumRevision > BigInt(library.revision)) {
      throw new AccountFailureError("invalid_input", 400);
    }
    const reusable = reusableSnapshot(
      prior,
      library.recovery_epoch,
      library.revision,
      input.minimumRevision
    );
    if (reusable) {
      return reusable;
    }
    const id = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + snapshotLimits.lifetimeMs
    ).toISOString();
    await tx`DELETE FROM library_snapshot WHERE instance_id=${instanceId} AND account_id=${accountId}`;
    await tx`INSERT INTO library_snapshot(instance_id,account_id,id,expires_at,manifest) VALUES(${instanceId},${accountId},${id},${expiresAt},'{}')`;
    const pages: SnapshotManifest["pages"] = [];
    const organization = await readOrganization(tx, {
      instanceId,
      accountId,
      revision: library.revision,
      textBytes: Number(library.text_bytes),
    });
    let records = snapshotRecordsSchema.parse({ organization, prompts: [] });
    const emptyWireBytes = () =>
      Buffer.byteLength(
        JSON.stringify({
          id,
          page: pages.length,
          payload: JSON.stringify({
            organization: records.organization,
            prompts: [],
          }),
        })
      );
    let wireBytes = emptyWireBytes();
    const writePage = async () => {
      const payload = JSON.stringify(records);
      const page = pages.length;
      const wire = JSON.stringify({ id, page, payload });
      if (
        Buffer.byteLength(wire) > snapshotLimits.pageBytes ||
        page >= snapshotLimits.pages
      ) {
        throw new Error("Snapshot page limit exceeded");
      }
      await tx`INSERT INTO library_snapshot_page(instance_id,account_id,snapshot_id,page,payload) VALUES(${instanceId},${accountId},${id},${page},${payload})`;
      pages.push({
        digest: new Bun.CryptoHasher("sha256").update(payload).digest("hex"),
        bytes: Buffer.byteLength(payload),
      });
      records = { organization: null, prompts: [] };
      wireBytes = emptyWireBytes();
    };
    let after = "00000000-0000-0000-0000-000000000000";
    while (true) {
      const rows =
        await tx`SELECT p.id, p.title, p.description, p.content, p.revision::text, p.created_at, p.modified_at, p.favorite, p.archived, p.collection_id, p.use_count, p.last_used_at, p.source_title,
      ARRAY(SELECT tag_id::text FROM prompt_tag t WHERE t.instance_id=p.instance_id AND t.account_id=p.account_id AND t.prompt_id=p.id AND t.add_revision > t.remove_revision ORDER BY tag_id) AS tag_ids
      FROM prompt p WHERE p.instance_id=${instanceId} AND p.account_id=${accountId} AND p.id > ${after}::uuid ORDER BY p.id LIMIT 8`;
      if (!rows.length) {
        break;
      }
      for (const row of rows) {
        const prompt = {
          instanceId,
          accountId,
          id: row.id,
          title: row.title,
          description: row.description,
          content: row.content,
          revision: row.revision,
          createdAt: row.created_at.toISOString(),
          modifiedAt: row.modified_at.toISOString(),
          favorite: row.favorite,
          archived: row.archived,
          collectionId: row.collection_id,
          tagIds: row.tag_ids,
          useCount: Number(row.use_count),
          lastUsedAt: row.last_used_at?.toISOString() ?? null,
          sourceTitle: row.source_title,
        };
        // Count each serialized prompt once, including escaping in the outer payload string.
        const bytes =
          Buffer.byteLength(JSON.stringify(JSON.stringify(prompt))) - 2;
        if (
          wireBytes + bytes + (records.prompts.length ? 1 : 0) >
          snapshotLimits.pageBytes
        ) {
          await writePage();
        }
        wireBytes += bytes + (records.prompts.length ? 1 : 0);
        records.prompts.push(prompt);
        after = row.id;
      }
    }
    await writePage();
    const manifest = snapshotManifestSchema.parse({
      instanceId,
      accountId,
      id,
      epoch: library.recovery_epoch,
      revision: library.revision,
      version: 1,
      normalization: "pr0-search-v1-ucd17",
      expiresAt,
      promptCount: library.prompt_count,
      pages,
    });
    await tx`UPDATE library_snapshot SET manifest=${JSON.stringify(manifest)} WHERE instance_id=${instanceId} AND account_id=${accountId}`;
    return manifest;
  });
