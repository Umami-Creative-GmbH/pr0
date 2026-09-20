import type { Database } from "bun:sqlite";

import { organizationSearch } from "@pr0/api-contract/organization";

import { trigramQuery } from "./search-grams";
import { SearchSlots, shortPostings } from "./search-postings";

interface OrganizationName {
  id: string;
  entity: "collection" | "tag";
  name: string;
}
interface IndexedName extends OrganizationName {
  slot: number;
}
const capacity = 1200;

export const organizationIndex = (db: Database) => {
  db.exec(`CREATE TABLE IF NOT EXISTS search_organization (
    slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 0 AND 1199),
    entity TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(entity,id));
    CREATE VIRTUAL TABLE IF NOT EXISTS f_name USING fts5(name,content='search_organization',content_rowid='slot',detail=none,columnsize=0,tokenize='trigram case_sensitive 1');
    CREATE TABLE IF NOT EXISTS search_membership (
    entity TEXT NOT NULL,id TEXT NOT NULL,slot INTEGER NOT NULL,PRIMARY KEY(entity,id,slot)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS search_membership_slot ON search_membership(slot);`);
  const postings = shortPostings(db, capacity);
  const remove = (row: IndexedName) => {
    db.query(
      "INSERT INTO f_name(f_name,rowid,name) VALUES ('delete',?,CAST(? AS TEXT))"
    ).run(row.slot, Buffer.from(row.name));
    postings.update("organization", row.slot, row.name, "");
    db.query("DELETE FROM search_organization WHERE slot=?").run(row.slot);
  };
  return {
    // Names have their own bounded slot domain. Renames never retrieve prompt bodies.
    reconcile(names: OrganizationName[]) {
      const previous = new Map(
        db
          .query<IndexedName, []>("SELECT * FROM search_organization")
          .all()
          .map((row) => [`${row.entity}:${row.id}`, row])
      );
      const current = new Set(names.map((row) => `${row.entity}:${row.id}`));
      const used = new Set<number>();
      for (const [key, row] of previous) {
        if (current.has(key)) {
          used.add(row.slot);
        } else {
          remove(row);
          previous.delete(key);
        }
      }
      for (const row of names) {
        const before = previous.get(`${row.entity}:${row.id}`);
        const name = organizationSearch(row.name);
        if (before?.name === name) {
          continue;
        }
        let slot = before?.slot ?? 0;
        if (before) {
          remove(before);
        } else {
          while (used.has(slot)) {
            slot += 1;
          }
        }
        if (slot >= capacity) {
          throw new Error("Organization search capacity exceeded");
        }
        used.add(slot);
        db.query(
          "INSERT INTO search_organization VALUES (?,?,?,CAST(? AS TEXT))"
        ).run(slot, row.entity, row.id, Buffer.from(name));
        db.query(
          "INSERT INTO f_name(rowid,name) VALUES (?,CAST(? AS TEXT))"
        ).run(slot, Buffer.from(name));
        postings.update("organization", slot, "", name);
      }
    },
    removePrompt(slot: number) {
      db.query("DELETE FROM search_membership WHERE slot=?").run(slot);
    },
    assign(slot: number, collectionId: string | null, tagIds: string[]) {
      db.query("DELETE FROM search_membership WHERE slot=?").run(slot);
      const insert = db.query("INSERT INTO search_membership VALUES (?,?,?)");
      if (collectionId) {
        insert.run("collection", collectionId, slot);
      }
      for (const id of tagIds) {
        insert.run("tag", id, slot);
      }
    },
    matches(term: string) {
      const points = [...term];
      let slots: number[];
      if (points.length < 3) {
        const hits = postings.get("organization", term);
        slots = db
          .query<{ slot: number }, []>("SELECT slot FROM search_organization")
          .all()
          .flatMap((row) => (hits.has(row.slot) ? [row.slot] : []));
      } else {
        slots = db
          .query<{ slot: number }, [string, Uint8Array]>(
            `SELECT slot FROM search_organization WHERE slot IN (SELECT rowid FROM f_name WHERE f_name MATCH ?) AND instr(name,CAST(? AS TEXT))>0`
          )
          .all(trigramQuery(points), Buffer.from(term))
          .map((row) => row.slot);
      }
      if (!slots.length) {
        return new SearchSlots([]);
      }
      return new SearchSlots(
        db
          .query<{ slot: number }, []>(
            `SELECT DISTINCT m.slot FROM search_membership m JOIN search_organization n USING(entity,id) WHERE n.slot IN (${slots.join(",")})`
          )
          .all()
          .map((row) => row.slot)
      );
    },
  };
};
