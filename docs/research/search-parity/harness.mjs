// oxlint-disable eslint/no-bitwise -- Bitmap membership and seeded PRNGs require exact 32-bit operations.
// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Samples and corpus writes run sequentially to avoid contaminating benchmark measurements.
// oxlint-disable react-doctor/js-combine-iterations -- Keep the independent reference oracle's filtering and projection separate from the measured search implementation.
// oxlint-disable eslint/no-nested-ternary -- Ordered expressions preserve the reference ranking and comparison branches used by these recorded experiments.
import { Database } from "bun:sqlite";
import { strict as assert } from "node:assert";

import { SQL } from "bun";

const root = import.meta.dir;
const foldFile = Bun.file(`${root}/CaseFolding-17.0.0.txt`);
if (!(await foldFile.exists())) {
  const response = await fetch(
    "https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt"
  );
  if (!response.ok) {
    throw new Error(`Unicode download: ${response.status}`);
  }
  await Bun.write(foldFile, await response.text());
}
const folding = new Map();
const foldingText = await foldFile.text();
for (const line of foldingText.split("\n")) {
  const [point, status, mapping] = line.split(";").map((part) => part.trim());
  if (status === "C" || status === "F") {
    folding.set(
      String.fromCodePoint(Number.parseInt(point, 16)),
      mapping
        .split(" ")
        .map((value) => String.fromCodePoint(Number.parseInt(value, 16)))
        .join("")
    );
  }
}
const marks = /\p{M}/u;
const diacritics = /\p{Diacritic}/u;
const whitespace = /\p{White_Space}+/gu;
const escapes = /[\\%_]/gu;
const quotes = /"/gu;
const normalize = (value) => {
  if (!value.isWellFormed() || value.includes("\0")) {
    throw new Error("Invalid scalar text or NUL");
  }
  const folded = Array.from(
    value.normalize("NFD"),
    (char) => folding.get(char) ?? char
  )
    .join("")
    .normalize("NFD");
  return Array.from(folded, (char) =>
    marks.test(char) && diacritics.test(char) ? "" : char
  )
    .join("")
    .replace(whitespace, " ")
    .replaceAll(/^ +| +$/gu, "");
};
const termsOf = (query) => {
  const normalized = normalize(query);
  return normalized ? [...new Set(normalized.split(" "))] : [];
};
const phrase = (term) => `"${term.replace(quotes, '""')}"`;
const pattern = (term) => `%${term.replace(escapes, "\\$&")}%`;
const fields = [
  "title",
  "content",
  "description",
  "tag1",
  "tag2",
  "collection",
];
const make = (
  id,
  title,
  content = "",
  description = "",
  tag1 = "",
  tag2 = "",
  collection = ""
) => ({ id, title, content, description, tag1, tag2, collection });
const raw = [
  make(
    1,
    "C++ guide",
    '100% done; under_score; C:\\temp; [draft]; "quote"; OR AND NOT'
  ),
  make(2, "C guide", "100X done; underXscore; C:temp; draft; quote"),
  make(3, "Café Über Straße", "Résumé; Σ σ ς; İ; ẞ; 𐐀; 😀"),
  make(4, "Cafe\u0301", "Ame\u0301lie; \uE000; 😀🦊"),
  make(5, "Email reply", "write", "", "German"),
  make(6, "Reply template", "email", "", "", "", "German"),
  make(7, "Response template", "", "German email"),
  make(8, "Translation helper", "German email"),
  make(9, "German email"),
  make(10, "Email templates in German"),
  make(11, "German only"),
  make(12, "boundary", "abc", "def"),
  make(13, 'literal x%_\\[]" OR', "percent% under_ slash\\ bracket[ ] plus++"),
  make(14, "A", "a ab abc"),
  make(15, "\uE000"),
  make(16, "😀"),
  make(17, "𐀀"),
  make(18, "Z"),
];
const fixtures = raw.map((row) => {
  const result = { id: row.id };
  for (const field of fields) {
    result[field] = normalize(row[field]);
  }
  result.search_text = fields.map((field) => result[field]).join(" ");
  return result;
});
const queries = [
  "",
  " ",
  "a",
  "ab",
  "C++",
  "++",
  "100%",
  "%",
  "_",
  "under_score",
  "\\",
  "C:\\temp",
  "[",
  "[draft]",
  '"',
  '"quote"',
  "OR",
  "AND",
  "NOT",
  'x%_\\[]"',
  "CAFE",
  "cafe\u0301",
  "uber",
  "ueber",
  "strasse",
  "ẞ",
  "σ",
  "ς",
  "i",
  "𐐨",
  "😀",
  "😀🦊",
  "German email",
  "email German",
  "  German \t email ",
  "cdef",
  "abc def",
  "summ",
  "\uE000",
];
const sqlitePath = `${root}/parity.sqlite`;
const db = new Database(sqlitePath, { create: true });
db.exec(
  "DROP TABLE IF EXISTS prompts; DROP TABLE IF EXISTS search; CREATE TABLE prompts(id INTEGER PRIMARY KEY, title TEXT, content TEXT, description TEXT, tag1 TEXT, tag2 TEXT, collection TEXT, search_text TEXT); CREATE VIRTUAL TABLE search USING fts5(search_text, content='prompts', content_rowid='id', tokenize='trigram case_sensitive 1');"
);
const insert = db.prepare("INSERT INTO prompts VALUES (?,?,?,?,?,?,?,?)");
db.transaction(() => {
  for (const row of fixtures) {
    insert.run(row.id, ...fields.map((field) => row[field]), row.search_text);
  }
})();
db.exec("INSERT INTO search(search) VALUES ('rebuild')");
const pg = new SQL(
  process.env.SEARCH_DATABASE_URL ??
    "postgres://postgres:search-research-only@127.0.0.1:55439/search_research"
);
await pg`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
await pg`DROP TABLE IF EXISTS prompts`;
await pg`CREATE TABLE prompts(id integer PRIMARY KEY, title text COLLATE "C", content text, description text, tag1 text, tag2 text, collection text, search_text text)`;
await pg`INSERT INTO prompts ${pg(fixtures)}`;
await pg`CREATE INDEX prompts_search_trgm ON prompts USING gin(search_text gin_trgm_ops)`;
const results = [];
for (const query of queries) {
  const terms = termsOf(query);
  const expected = fixtures
    .filter((row) =>
      terms.every((term) => fields.some((field) => row[field].includes(term)))
    )
    .map((row) => row.id);
  const exact =
    terms
      .map(
        () =>
          `(${fields.map((field) => `instr(${field}, ?) > 0`).join(" OR ")})`
      )
      .join(" AND ") || "1";
  const values = terms.flatMap((term) => fields.map(() => term));
  const indexed = terms.filter((term) => [...term].length >= 3);
  const ftsQuery = indexed.map(phrase).join(" AND ");
  const candidate = indexed.length
    ? "id IN (SELECT rowid FROM search WHERE search MATCH ?) AND "
    : "";
  const sqliteIds = db
    .query(`SELECT id FROM prompts WHERE ${candidate}${exact} ORDER BY id`)
    .all(...(indexed.length ? [ftsQuery] : []), ...values)
    .map((row) => row.id);
  const params = [];
  const pgParts = terms.map((term) => {
    params.push(pattern(term));
    const patternIndex = params.length;
    params.push(term);
    const exactIndex = params.length;
    return `(search_text LIKE $${patternIndex} ESCAPE '\\' AND (${fields.map((field) => `strpos(${field}, $${exactIndex}) > 0`).join(" OR ")}))`;
  });
  const pgMatches = await pg.unsafe(
    `SELECT id FROM prompts WHERE ${pgParts.join(" AND ") || "true"} ORDER BY id`,
    params
  );
  const pgIds = pgMatches.map((row) => row.id);
  assert.deepEqual(sqliteIds, expected, `SQLite ${query}`);
  assert.deepEqual(pgIds, expected, `PostgreSQL ${query}`);
  results.push({
    query,
    expected,
    ftsQuery,
    sqlite: sqliteIds,
    postgres: pgIds,
  });
}
const scalarOrder = fixtures
  .toSorted(
    (a, b) =>
      Buffer.compare(Buffer.from(a.title), Buffer.from(b.title)) || a.id - b.id
  )
  .map((row) => row.id);
const sqliteOrder = db
  .query("SELECT id FROM prompts ORDER BY title COLLATE BINARY, id")
  .all()
  .map((row) => row.id);
const orderedPgRows =
  await pg`SELECT id FROM prompts ORDER BY title COLLATE "C", id`;
const pgOrder = orderedPgRows.map((row) => row.id);
assert.deepEqual(sqliteOrder, scalarOrder);
assert.deepEqual(pgOrder, scalarOrder);
const utf16Order = fixtures
  .toSorted(
    (a, b) =>
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || a.id - b.id
  )
  .map((row) => row.id);
assert.notDeepEqual(utf16Order, scalarOrder);
assert.throws(() => normalize("\uD800"));
assert.throws(() => normalize("\0"));
let postgresNul;
try {
  await pg`SELECT ${"a\0b"}::text`;
  postgresNul = "unexpected acceptance";
} catch (error) {
  postgresNul = { code: error.code, message: error.message };
}
assert.notEqual(postgresNul, "unexpected acceptance");
const rawShortMatch = db
  .query("SELECT rowid FROM search WHERE search MATCH ?")
  .all(phrase("a"));
assert.equal(rawShortMatch.length, 0);
const quoteOnlyMatch = db
  .query("SELECT rowid FROM search WHERE search MATCH ?")
  .all(phrase('"'));
assert.equal(quoteOnlyMatch.length, 0);
const versions = {
  bun: Bun.version,
  unicode: process.versions.unicode,
  icu: process.versions.icu,
  sqlite: db.query("select sqlite_version() as version").get(),
  postgres:
    await pg`SELECT version(), current_setting('server_encoding') AS encoding, (SELECT datcollate FROM pg_database WHERE datname=current_database()) AS collation`,
  pgTrgm: await pg`SELECT extversion FROM pg_extension WHERE extname='pg_trgm'`,
  caseFoldingSha256: new Bun.CryptoHasher("sha256")
    .update(await foldFile.arrayBuffer())
    .digest("hex"),
};
await Bun.write(
  `${root}/results.json`,
  JSON.stringify(
    {
      versions,
      cases: results.length,
      results,
      scalarOrder,
      utf16Order,
      postgresNul,
      rawShortMatch,
      quoteOnlyMatch,
    },
    null,
    2
  )
);
await Bun.write(
  `${root}/native-cases.json`,
  JSON.stringify(
    results.map(({ query, expected, ftsQuery }) => ({
      query,
      expected,
      ftsQuery,
      terms: termsOf(query),
    })),
    null,
    2
  )
);
process.stdout.write(
  `Passed ${results.length} PostgreSQL/SQLite parity cases; scalar ordering; NUL rejection.\n`
);
const stats = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return { min: sorted[0], p50: sorted[9], p95: sorted[18], max: sorted[19] };
};
if (process.env.SEARCH_BENCH === "1") {
  await pg`DROP TABLE IF EXISTS bench`;
  await pg`CREATE TABLE bench(id integer PRIMARY KEY, title text COLLATE "C", content text, search_text text)`;
  db.exec(
    "DROP TABLE IF EXISTS bench; DROP TABLE IF EXISTS bench_fts; CREATE TABLE bench(id INTEGER PRIMARY KEY,title TEXT,content TEXT, search_text TEXT); CREATE VIRTUAL TABLE bench_fts USING fts5(search_text, content='bench',content_rowid='id', tokenize='trigram case_sensitive 1');"
  );
  const benchInsert = db.prepare("INSERT INTO bench VALUES (?,?,?,?)");
  const totalBytes = 100 * 1024 * 1024;
  let remaining = totalBytes;
  let state = 1729;
  const noise = (length) => {
    let value = "";
    for (let i = 0; i < length; i += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      value += String.fromCodePoint(97 + ((state >>> 0) % 26));
    }
    return value;
  };
  for (let start = 1; start <= 10_000; start += 100) {
    const batch = [];
    for (let id = start; id < start + 100; id += 1) {
      const title = `prompt ${String(id).padStart(5, "0")}`;
      const allowance = Math.floor(remaining / (10_001 - id));
      const content = `common ${noise(allowance - title.length - 7)}`;
      remaining -= title.length + content.length;
      batch.push({ id, title, content, search_text: `${title} ${content}` });
    }
    db.transaction(() => {
      for (const row of batch) {
        benchInsert.run(row.id, row.title, row.content, row.search_text);
      }
    })();
    await pg`INSERT INTO bench ${pg(batch)}`;
  }
  assert.equal(remaining, 0);
  const sqliteBuild = performance.now();
  db.exec("INSERT INTO bench_fts(bench_fts) VALUES ('rebuild')");
  const sqliteIndexMs = performance.now() - sqliteBuild;
  const pgBuild = performance.now();
  await pg`CREATE INDEX bench_trgm ON bench USING gin(search_text gin_trgm_ops)`;
  const pgIndexMs = performance.now() - pgBuild;
  await pg`ANALYZE bench`;
  const timings = [];
  for (const query of ["🫠", "🫠x", "a", "ab", "common", "zzzzzz"]) {
    const like = pattern(query);
    const long = [...query].length >= 3;
    const statement = db.prepare(
      `SELECT id FROM bench WHERE ${long ? "id IN (SELECT rowid FROM bench_fts WHERE bench_fts MATCH ?) AND " : ""}(instr(title,?)>0 OR instr(content,?)>0) ORDER BY title COLLATE BINARY,id LIMIT 50`
    );
    const args = long ? [phrase(query), query, query] : [query, query];
    const local = [];
    const remote = [];
    let ids;
    for (let run = 0; run < 21; run += 1) {
      let before = performance.now();
      const sqlRows = statement.all(...args);
      const localMs = performance.now() - before;
      before = performance.now();
      const pgRows =
        await pg`SELECT id FROM bench WHERE search_text LIKE ${like} ESCAPE '\\' AND (strpos(title,${query})>0 OR strpos(content,${query})>0) ORDER BY title COLLATE "C",id LIMIT 50`;
      const pgMs = performance.now() - before;
      assert.deepEqual(
        sqlRows.map((row) => row.id),
        pgRows.map((row) => row.id)
      );
      ids = sqlRows.map((row) => row.id);
      if (run > 0) {
        local.push(localMs);
        remote.push(pgMs);
      }
    }
    const plan =
      await pg`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM bench WHERE search_text LIKE ${like} ESCAPE '\\' AND (strpos(title,${query})>0 OR strpos(content,${query})>0) ORDER BY title COLLATE "C",id LIMIT 50`;
    timings.push({
      query,
      sqliteMs: stats(local),
      postgresMs: stats(remote),
      resultCount: ids.length,
      pgPlan: plan,
      sqlitePlan: db
        .query(`EXPLAIN QUERY PLAN ${statement.toString()}`)
        .all(...args),
    });
  }
  await Bun.write(
    `${root}/benchmark.json`,
    JSON.stringify(
      {
        rows: 10_000,
        textBytes: totalBytes,
        sqliteIndexMs,
        pgIndexMs,
        pgSize:
          await pg`SELECT pg_size_pretty(pg_total_relation_size('bench')) AS total, pg_size_pretty(pg_indexes_size('bench')) AS indexes`,
        sqlitePages: db.query("PRAGMA page_count").get(),
        sqlitePageSize: db.query("PRAGMA page_size").get(),
        timings,
      },
      null,
      2
    )
  );
  process.stdout.write("Maximum-library bounded benchmark finished.\n");
}
db.close();
await pg.close();
