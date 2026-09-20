// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop, react-doctor/server-sequential-independent-await -- Snapshot pages and projection checkpoints must be consumed in order.
import { existsSync, mkdirSync, renameSync, rmSync, statfsSync } from "node:fs";
import path from "node:path";

import {
  promptPageSchema,
  searchNormalizationVersion,
} from "@pr0/api-contract/prompts";
import type { TransactionSQL } from "bun";

import { database } from "./database";
import { searchCursor } from "./search-cursor";
import { openSearchIndex } from "./search-index";
import type { SearchJob, SearchRecord } from "./search-types";

const readSearchSnapshot = async (tx: TransactionSQL, job: SearchJob) => {
  const [library] = await tx<
    {
      revision: string;
      text_bytes: string;
      prompt_count: number;
      epoch: string;
    }[]
  >`
        SELECT l.revision::text,l.text_bytes::text,l.prompt_count,i.recovery_epoch AS epoch FROM library l
        JOIN instance i ON i.id=l.instance_id WHERE l.instance_id=${job.scope.instance} AND l.account_id=${job.scope.account}`;
  if (
    !library ||
    library.epoch !== job.scope.epoch ||
    BigInt(library.revision) < BigInt(job.scope.revision)
  ) {
    throw new Error("Search partition changed");
  }

  return library;
};
const indexVersion = `4:${searchNormalizationVersion}`;
export const searchDirectory = () =>
  path.resolve(process.env.PR0_SEARCH_DIRECTORY ?? ".data/search");
const invalidIndexes = new Set<string>();
const projectSearch = async (job: SearchJob) => {
  const directory = searchDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const key = `${job.scope.instance}-${job.scope.account}`;
  const filename = path.join(directory, `${key}.sqlite`);
  const staging = `${filename}.building`;
  let index: ReturnType<typeof openSearchIndex> | undefined;
  let staged = false;
  const started = performance.now();
  let indexed = 0;
  try {
    let compatible = false;
    if (existsSync(filename) && !invalidIndexes.has(key)) {
      try {
        index = openSearchIndex(filename);
        compatible =
          index.state("version") === indexVersion &&
          index.state("instance") === job.scope.instance &&
          index.state("account") === job.scope.account &&
          index.state("epoch") === job.scope.epoch;
      } catch {
        compatible = false;
      }
    }
    const result = await database().begin(
      "ISOLATION LEVEL REPEATABLE READ READ ONLY",
      async (tx) => {
        const library = await readSearchSnapshot(tx, job);
        let applied = compatible ? (index?.state("revision") ?? "0") : "0";
        if (compatible && applied !== library.revision) {
          const [feed] = await tx<
            { count: string }[]
          >`SELECT count(*)::text AS count FROM library_change
          WHERE instance_id=${job.scope.instance} AND account_id=${job.scope.account} AND revision>${applied}::bigint AND revision<=${library.revision}::bigint`;
          compatible =
            BigInt(feed?.count ?? "0") ===
            BigInt(library.revision) - BigInt(applied);
        }
        if (!compatible) {
          index?.db.close();
          index = undefined;
          const space = statfsSync(directory);
          // Reserve a staged copy plus journal/scratch; failure affects only derived search data.
          if (
            space.bavail * space.bsize <
            Math.max(16_777_216, Number(library.text_bytes) * 6)
          ) {
            throw new Error("Insufficient search rebuild space");
          }
          rmSync(staging, { force: true });
          index = openSearchIndex(staging);
          staged = true;
          applied = "0";
        }
        if (!index) {
          throw new Error("Search projection unavailable");
        }
        const projection = index;
        if (applied !== library.revision || !compatible) {
          projection.db.exec("BEGIN IMMEDIATE");
          try {
            const names = await tx<
              { id: string; entity: "tag" | "collection"; name: string }[]
            >`
              SELECT id,'tag' AS entity,name FROM tag WHERE instance_id=${job.scope.instance} AND account_id=${job.scope.account}
              UNION ALL SELECT id,'collection' AS entity,name FROM collection WHERE instance_id=${job.scope.instance} AND account_id=${job.scope.account}`;
            projection.organization.reconcile(names);
            const deleted = await tx<
              { prompt_id: string }[]
            >`SELECT prompt_id FROM prompt_deletion
            WHERE instance_id=${job.scope.instance} AND account_id=${job.scope.account} AND revision>${applied}::bigint`;
            for (const row of deleted) {
              projection.remove(row.prompt_id);
            }
            let after = "00000000-0000-0000-0000-000000000000";
            while (true) {
              // At most sixteen maximum-sized canonical bodies plus small metadata per transfer.
              const rows = await tx<
                SearchRecord[]
              >`SELECT p.id,p.title,p.description,CASE WHEN GREATEST(p.title_revision,p.description_revision,p.content_revision)>${applied}::bigint THEN p.content ELSE NULL END AS content,p.revision::text,p.created_at,p.modified_at,p.last_used_at,p.favorite,p.archived,p.collection_id,
              to_json(ARRAY(SELECT m.tag_id FROM prompt_tag m WHERE m.instance_id=p.instance_id AND m.account_id=p.account_id AND m.prompt_id=p.id AND m.add_revision>m.remove_revision ORDER BY m.tag_id)) AS tag_ids
              FROM prompt p WHERE p.instance_id=${job.scope.instance} AND p.account_id=${job.scope.account} AND p.revision>${applied}::bigint AND p.id>${after}::uuid ORDER BY p.id LIMIT 16`;
              if (!rows.length) {
                break;
              }
              for (const row of rows) {
                projection.upsert(row);
                indexed += 1;
                after = row.id;
              }
            }
            projection.setState("revision", library.revision);
            projection.setState("epoch", library.epoch);
            projection.setState("version", indexVersion);
            projection.setState("instance", job.scope.instance);
            projection.setState("account", job.scope.account);
            projection.db.exec("COMMIT");
          } catch (error) {
            projection.db.exec("ROLLBACK");
            throw error;
          }
        }
        return library;
      }
    );
    if (!index) {
      throw new Error("Search index unavailable");
    }
    if (staged) {
      index.db.close();
      index = undefined;
      renameSync(staging, filename);
      index = openSearchIndex(filename);
    }
    invalidIndexes.delete(key);
    const indexMs = performance.now() - started;
    const cursor = searchCursor(
      { ...job.scope, revision: result.revision },
      job.input
    );
    const cancelled = () => {
      if (Atomics.load(new Int32Array(job.cancellation), 0)) {
        throw new Error("Search cancelled");
      }
    };
    cancelled();
    const queryStarted = performance.now();
    const found = index.db.transaction(() =>
      index?.search(job.input, cursor.offset, cancelled)
    )();
    if (!found) {
      throw new Error("Search unavailable");
    }
    const page = promptPageSchema.parse({
      accountId: job.scope.account,
      instanceId: job.scope.instance,
      revision: result.revision,
      prompts: found.summaries.map((summary) => JSON.parse(summary)),
      nextCursor: cursor.next(found.nextOffset),
      usage: {
        promptCount: result.prompt_count,
        textBytes: Number(result.text_bytes),
      },
    });
    return {
      page,
      timing: {
        indexMs,
        queryMs: performance.now() - queryStarted,
        indexed,
        checkedBodies: found.checkedBodies,
        fetchedBytes: found.fetchedBytes,
        candidates: found.candidates,
      },
    };
  } catch (error) {
    // Protocol errors and cancellation never invalidate a healthy projection.
    if (
      !(error instanceof Error) ||
      (!error.message.includes("cancelled") && !("detail" in error))
    ) {
      invalidIndexes.clear();
      invalidIndexes.add(key);
    }
    throw error;
  } finally {
    index?.db.close();
  }
};

export const searchProjection = (job: SearchJob) =>
  database().begin(async (tx) => {
    // Cross-process exclusion covers the complete lifetime of the derived files.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${job.scope.account},56))`;
    const [owner] =
      await tx`SELECT id FROM "user" WHERE id=${job.scope.account} AND NOT deletion_pending`;
    if (!owner) {
      throw new Error("Search partition changed");
    }
    return projectSearch(job);
  });
