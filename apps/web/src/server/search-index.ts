// oxlint-disable react-doctor/js-set-map-lookups -- Literal substring matching operates on strings, not array membership.
import { Database } from "bun:sqlite";

import { contentExcerpt } from "@pr0/api-contract/excerpt";
import { organizationSearch } from "@pr0/api-contract/organization";

import { trigramQuery } from "./search-grams";
import { organizationIndex } from "./search-organization-index";
import { shortPostings, SearchSlots } from "./search-postings";
import type { SearchInput, SearchRecord } from "./search-types";

const summaryFor = (row: SearchRecord, excerpt: string) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  excerpt,
  revision: row.revision,
  createdAt: row.created_at.toISOString(),
  modifiedAt: row.modified_at.toISOString(),
  favorite: row.favorite,
  archived: row.archived,
  collectionId: row.collection_id,
  tagIds: row.tag_ids,
});

const fields = ["title", "description", "content"] as const;
type Field = (typeof fields)[number];
interface IndexedRow {
  slot: number;
  id: string;
  title: string;
  description: string;
  content: string;
  content_bytes: number;
  summary: string;
  created: number;
  modified: number;
  used: number | null;
  archived: number;
  favorite: number;
  collection_id: string | null;
  tags: string;
}
type SearchMetadata = Omit<IndexedRow, "content" | "summary">;
type Candidate = SearchMetadata & { tier: number; key: Buffer };
interface TermHits {
  term: string;
  exact: boolean;
  title: SearchSlots;
  description: SearchSlots;
  content: SearchSlots;
  organization: SearchSlots;
}
const recentUse = (a: Candidate, b: Candidate) => {
  if (a.used === null) {
    return b.used === null ? 0 : 1;
  }
  if (b.used === null) {
    return -1;
  }
  return b.used - a.used;
};
const matchesTags = (stored: string, selected: string[]) => {
  const tags = new Set<string>(JSON.parse(stored));
  return selected.every((tag) => tags.has(tag));
};
const withinScope = (row: SearchMetadata, input: SearchInput) =>
  row.archived === Number(input.view === "archive") &&
  (input.view !== "favorites" || Boolean(row.favorite)) &&
  (input.view !== "recents" || row.used !== null) &&
  (input.favorite === undefined || row.favorite === Number(input.favorite)) &&
  (!input.viewCollectionId || row.collection_id === input.viewCollectionId) &&
  (!input.collectionId || row.collection_id === input.collectionId);
const orderedCandidates = (
  rows: SearchMetadata[],
  {
    input,
    query,
    terms,
    hits,
    sort,
  }: {
    input: SearchInput;
    query: string;
    terms: string[];
    hits: TermHits[];
    sort: NonNullable<SearchInput["sort"]>;
  }
) => {
  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (!withinScope(row, input)) {
      continue;
    }
    if (input.tagIds?.length && !matchesTags(row.tags, input.tagIds)) {
      continue;
    }
    if (
      !hits.every(
        (hit) =>
          hit.title.has(row.slot) ||
          hit.organization.has(row.slot) ||
          hit.description.has(row.slot) ||
          hit.content.has(row.slot)
      )
    ) {
      continue;
    }
    const titleCount = terms.filter((term) => row.title.includes(term)).length;
    let tier = 6;
    if (terms.some((term) => row.description.includes(term))) {
      tier = 5;
    }
    if (hits.some((hit) => hit.organization.has(row.slot))) {
      tier = 4;
    }
    if (titleCount > 0) {
      tier = 3;
    }
    if (titleCount === terms.length) {
      tier = 2;
    }
    if (row.title === query) {
      tier = 1;
    }
    candidates.push({ ...row, tier, key: Buffer.from(row.title) });
  }
  candidates.sort((a, b) => {
    let primary = 0;
    if (sort === "relevance" && query) {
      primary = a.tier - b.tier || recentUse(a, b) || b.modified - a.modified;
    } else if (sort === "recently-used") {
      primary =
        recentUse(a, b) ||
        (a.used === null && b.used === null ? b.modified - a.modified : 0);
    } else if (sort === "recently-modified" || sort === "relevance") {
      primary = b.modified - a.modified;
    } else if (sort === "newest") {
      primary = b.created - a.created;
    } else if (sort === "oldest") {
      primary = a.created - b.created;
    }
    return (
      primary ||
      Buffer.compare(a.key, b.key) ||
      (a.id < b.id ? -1 : Number(a.id > b.id))
    );
  });

  return candidates;
};

const verifyBatch = (db: Database, slots: number[], terms: string[]) => {
  // A single exact substring predicate can stay inside SQLite: each bounded
  // candidate body is read once without copying rejected text into JavaScript.
  const [term] = terms;
  if (terms.length === 1 && term !== undefined) {
    const matches = new SearchSlots(
      db
        .query<{ slot: number }, [Uint8Array]>(
          `SELECT slot FROM search_prompt WHERE slot IN (${slots.join(",")}) AND instr(content,CAST(? AS TEXT))>0`
        )
        .all(Buffer.from(term))
        .map((row) => row.slot)
    );
    return (slot: number, _outstanding: TermHits[]) => matches.has(slot);
  }
  const bodies = new Map(
    db
      .query<{ slot: number; content: string }, []>(
        `SELECT slot,content FROM search_prompt WHERE slot IN (${slots.join(",")})`
      )
      .all()
      .map((row) => [row.slot, row.content])
  );
  return (slot: number, outstanding: TermHits[]) => {
    const content = bodies.get(slot);
    return (
      content !== undefined &&
      outstanding.every((hit) => content.includes(hit.term))
    );
  };
};

export const openSearchIndex = (filename: string) => {
  const db = new Database(filename, { create: true, strict: true });
  try {
    db.exec(`PRAGMA cache_size=-65536; PRAGMA mmap_size=0; PRAGMA journal_mode=DELETE;
    CREATE TABLE IF NOT EXISTS search_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS search_prompt (slot INTEGER PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS search_metadata (
      slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 0 AND 9999), id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL, content_bytes INTEGER NOT NULL,
      summary TEXT NOT NULL, created INTEGER NOT NULL, modified INTEGER NOT NULL, used INTEGER,
      archived INTEGER NOT NULL, favorite INTEGER NOT NULL, collection_id TEXT, tags TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS search_short (field TEXT NOT NULL, gram TEXT NOT NULL,
      representation TEXT NOT NULL, payload BLOB NOT NULL, count INTEGER NOT NULL,
      PRIMARY KEY(field,gram)) WITHOUT ROWID;`);
    for (const field of fields) {
      db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS f_${field} USING fts5(${field}, content='search_prompt', content_rowid='slot', detail=none, columnsize=0, tokenize='trigram case_sensitive 1')`
      );
    }
  } catch (error) {
    db.close();
    throw error;
  }
  const postings = shortPostings(db);
  const organization = organizationIndex(db);
  const get = db.query<IndexedRow, [string]>(
    "SELECT m.*,p.content FROM search_metadata m JOIN search_prompt p USING(slot) WHERE m.id=?"
  );
  const state = db.query<{ value: string }, [string]>(
    "SELECT value FROM search_state WHERE key=?"
  );
  const replaceField = (
    field: Field,
    slot: number,
    before: string | undefined,
    after?: string
  ) => {
    if (before === after) {
      return;
    }
    if (before !== undefined) {
      db.query(
        `INSERT INTO f_${field}(f_${field},rowid,${field}) VALUES ('delete',?,CAST(? AS TEXT))`
      ).run(slot, Buffer.from(before));
    }
    if (after !== undefined) {
      db.query(
        `INSERT INTO f_${field}(rowid,${field}) VALUES (?,CAST(? AS TEXT))`
      ).run(slot, Buffer.from(after));
    }
    postings.update(field, slot, before ?? "", after ?? "");
  };
  return {
    db,
    organization,
    state: (key: string) => state.get(key)?.value,
    setState: (key: string, value: string) =>
      db
        .query("INSERT OR REPLACE INTO search_state VALUES (?,?)")
        .run(key, value),
    remove(id: string) {
      const old = get.get(id);
      if (!old) {
        return;
      }
      for (const field of fields) {
        replaceField(field, old.slot, old[field]);
      }
      db.query("DELETE FROM search_prompt WHERE slot=?").run(old.slot);
      db.query("DELETE FROM search_metadata WHERE slot=?").run(old.slot);
      organization.removePrompt(old.slot);
    },
    upsert(row: SearchRecord) {
      if (row.content === null) {
        const current = db
          .query<{ slot: number; excerpt: string }, [string]>(
            "SELECT slot,json_extract(summary,'$.excerpt') AS excerpt FROM search_metadata WHERE id=?"
          )
          .get(row.id);
        if (!current) {
          throw new Error("Missing search summary for metadata update");
        }
        organization.assign(current.slot, row.collection_id, row.tag_ids);
        db.query(
          "UPDATE search_metadata SET summary=?,modified=?,used=?,archived=?,favorite=?,collection_id=?,tags=? WHERE id=?"
        ).run(
          JSON.stringify(summaryFor(row, current.excerpt)),
          row.modified_at.getTime(),
          row.last_used_at?.getTime() ?? null,
          Number(row.archived),
          Number(row.favorite),
          row.collection_id,
          JSON.stringify(row.tag_ids),
          row.id
        );
        return;
      }
      const old = get.get(row.id);
      const slot =
        old?.slot ??
        db
          .query<{ slot: number }, []>(
            "SELECT COALESCE((SELECT MIN(p.slot+1) FROM search_metadata p WHERE p.slot<9999 AND NOT EXISTS(SELECT 1 FROM search_metadata next WHERE next.slot=p.slot+1)),0) AS slot WHERE EXISTS(SELECT 1 FROM search_metadata WHERE slot=0) UNION ALL SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM search_metadata WHERE slot=0)"
          )
          .get()?.slot;
      if (slot === undefined) {
        throw new Error("Search slot capacity exceeded");
      }
      organization.assign(slot, row.collection_id, row.tag_ids);
      const normalized = {
        title: organizationSearch(row.title),
        description: organizationSearch(row.description),
        content: organizationSearch(row.content),
      };
      for (const field of fields) {
        replaceField(field, slot, old?.[field], normalized[field]);
      }
      db.query(
        "INSERT OR REPLACE INTO search_prompt VALUES (?,CAST(? AS TEXT),CAST(? AS TEXT),CAST(? AS TEXT))"
      ).run(
        slot,
        Buffer.from(normalized.title),
        Buffer.from(normalized.description),
        Buffer.from(normalized.content)
      );
      db.query(
        "INSERT OR REPLACE INTO search_metadata VALUES (?,?,CAST(? AS TEXT),CAST(? AS TEXT),?,?,?,?,?,?,?,?,?)"
      ).run(
        slot,
        row.id,
        Buffer.from(normalized.title),
        Buffer.from(normalized.description),
        Buffer.byteLength(normalized.content),
        JSON.stringify(summaryFor(row, contentExcerpt(row.content))),
        row.created_at.getTime(),
        row.modified_at.getTime(),
        row.last_used_at?.getTime() ?? null,
        Number(row.archived),
        Number(row.favorite),
        row.collection_id,
        JSON.stringify(row.tag_ids)
      );
    },
    search(input: SearchInput, offset: number, cancelled: () => void) {
      const query = organizationSearch(input.query);
      const terms = [...new Set(query.split(" ").filter(Boolean))];
      const browseDefault =
        input.view === "recents" ? "recently-used" : "recently-modified";
      const sort = input.sort ?? (query ? "relevance" : browseDefault);
      const candidatesFor = (field: Field, term: string) => {
        const points = [...term];
        if (points.length < 3) {
          return postings.get(field, term);
        }
        return new SearchSlots(
          db
            .query<{ id: number }, [string]>(
              `SELECT rowid AS id FROM f_${field} WHERE f_${field} MATCH ?`
            )
            .all(trigramQuery(points))
            .map((row) => row.id)
        );
      };
      // Candidate sets are bounded by the 10,000-slot library domain, never by an arbitrary hit cap.
      const hits = terms.map((term) => {
        cancelled();
        return {
          term,
          exact: [...term].length <= 3,
          title: candidatesFor("title", term),
          description: candidatesFor("description", term),
          content: candidatesFor("content", term),
          organization: organization.matches(term),
        };
      });
      const rows = db
        .query<SearchMetadata, []>(
          `SELECT slot,id,title,description,content_bytes,created,modified,used,archived,favorite,collection_id,${input.tagIds?.length ? "tags" : "'[]' AS tags"} FROM search_metadata`
        )
        .all();
      const candidates = orderedCandidates(rows, {
        input,
        query,
        terms,
        hits,
        sort,
      });
      const matches: string[] = [];
      let nextOffset = offset;
      let checkedBodies = 0;
      let fetchedBytes = 0;
      let verifyBody: ReturnType<typeof verifyBatch> | null = null;
      let batchEnd = offset;
      for (let index = offset; index < candidates.length; index += 1) {
        cancelled();
        const row = candidates[index];
        if (!row) {
          break;
        }
        const outstanding = hits.filter(
          (hit) =>
            !row.title.includes(hit.term) &&
            !row.description.includes(hit.term) &&
            !hit.organization.has(row.slot)
        );
        if (outstanding.some((hit) => !hit.content.has(row.slot))) {
          continue;
        }
        if (outstanding.some((hit) => !hit.exact)) {
          if (index >= batchEnd) {
            const slots: number[] = [];
            let bytes = 0;
            batchEnd = index;
            while (batchEnd < candidates.length && slots.length < 64) {
              const next = candidates[batchEnd];
              if (!next || bytes + next.content_bytes > 4_194_304) {
                break;
              }
              slots.push(next.slot);
              bytes += next.content_bytes;
              batchEnd += 1;
            }
            verifyBody = verifyBatch(db, slots, terms);
            fetchedBytes += bytes;
          }
          checkedBodies += 1;
          if (!verifyBody?.(row.slot, outstanding)) {
            continue;
          }
        }
        if (matches.length === input.limit) {
          return {
            summaries: matches,
            nextOffset,
            checkedBodies,
            fetchedBytes,
            candidates: candidates.length,
          };
        }
        const summary = db
          .query<{ summary: string }, [number]>(
            "SELECT summary FROM search_metadata WHERE slot=?"
          )
          .get(row.slot);
        if (!summary) {
          throw new Error("Missing search summary");
        }
        matches.push(summary.summary);
        nextOffset = index + 1;
      }
      return {
        summaries: matches,
        nextOffset: null,
        checkedBodies,
        fetchedBytes,
        candidates: candidates.length,
      };
    },
  };
};
