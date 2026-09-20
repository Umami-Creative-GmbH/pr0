import { Database } from "bun:sqlite";
import { strict as assert } from "node:assert";

import { SQL } from "bun";

const db = new Database(`${import.meta.dir}/parity.sqlite`);
const pg = new SQL(
  process.env.SEARCH_DATABASE_URL ??
    "postgres://postgres:search-research-only@127.0.0.1:55439/search_research"
);
const fields = [
  "title",
  "content",
  "description",
  "tag1",
  "tag2",
  "collection",
];
const terms = ["german", "email"];
const values = [];
const contains = (field, term, dialect) => {
  values.push(term);
  return dialect === "pg"
    ? `strpos(${field},$${values.length})>0`
    : `instr(${field},?)>0`;
};
const build = (dialect) => {
  values.length = 0;
  values.push("german email");
  const equality = dialect === "pg" ? "title=$1" : "title=?";
  const titleAll = terms
    .map((term) => contains("title", term, dialect))
    .join(" AND ");
  const titleAny = terms
    .map((term) => contains("title", term, dialect))
    .join(" OR ");
  const org = terms
    .flatMap((term) =>
      ["tag1", "tag2", "collection"].map((field) =>
        contains(field, term, dialect)
      )
    )
    .join(" OR ");
  const description = terms
    .map((term) => contains("description", term, dialect))
    .join(" OR ");
  const eligible = terms
    .map(
      (term) =>
        `(${fields.map((field) => contains(field, term, dialect)).join(" OR ")})`
    )
    .join(" AND ");
  return `SELECT id, CASE WHEN ${equality} THEN 1 WHEN ${titleAll} THEN 2 WHEN ${titleAny} THEN 3 WHEN ${org} THEN 4 WHEN ${description} THEN 5 ELSE 6 END AS tier FROM prompts WHERE ${eligible} ORDER BY tier,title COLLATE ${dialect === "pg" ? '"C"' : "BINARY"},id`;
};
const sqliteSql = build("sqlite");
const sqlite = db.query(sqliteSql).all(...values);
const pgSql = build("pg");
const postgres = [...(await pg.unsafe(pgSql, values))];
assert.deepEqual(sqlite, [
  { id: 9, tier: 1 },
  { id: 10, tier: 2 },
  { id: 5, tier: 3 },
  { id: 6, tier: 4 },
  { id: 7, tier: 5 },
  { id: 8, tier: 6 },
]);
assert.deepEqual(postgres, sqlite);
const plans = {
  like: db
    .query(
      "EXPLAIN QUERY PLAN SELECT rowid FROM search WHERE search_text LIKE ?"
    )
    .all("%c++%"),
  escapedLike: db
    .query(
      "EXPLAIN QUERY PLAN SELECT rowid FROM search WHERE search_text LIKE ? ESCAPE '\\'"
    )
    .all("%c++%"),
  quotedMatch: db
    .query("EXPLAIN QUERY PLAN SELECT rowid FROM search WHERE search MATCH ?")
    .all('"c++"'),
};
await Bun.write(
  `${import.meta.dir}/ranking-results.json`,
  JSON.stringify({ sqlite, postgres, plans }, null, 2)
);
process.stdout.write(
  "Six accepted ranking tiers agree in PostgreSQL and SQLite; LIKE ESCAPE planner boundary captured.\n"
);
db.close();
await pg.close();
