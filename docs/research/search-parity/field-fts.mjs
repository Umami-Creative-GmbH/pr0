import { Database } from "bun:sqlite";
import { strict as assert } from "node:assert";

const root = import.meta.dir;
const db = new Database(`${root}/parity.sqlite`);
const fields = [
  "title",
  "content",
  "description",
  "tag1",
  "tag2",
  "collection",
];
const records = db.query("SELECT * FROM prompts ORDER BY id").all();
const manyTerms = Array.from(
  { length: 50 },
  (_, i) => `p${String(i).padStart(2, "0")}`
).join(" ");
records.push({
  id: 100,
  title: manyTerms,
  content: "x".repeat(200),
  description: "a".repeat(200),
  tag1: "",
  tag2: "",
  collection: "",
});
db.exec(
  "DROP TABLE IF EXISTS exact_fields; CREATE VIRTUAL TABLE exact_fields USING fts5(title,content,description,tag1,tag2,collection,tokenize='trigram case_sensitive 1')"
);
const insert = db.prepare(
  "INSERT INTO exact_fields(rowid,title,content,description,tag1,tag2,collection) VALUES(?,?,?,?,?,?,?)"
);
db.transaction(() => {
  for (const row of records) {
    insert.run(row.id, ...fields.map((field) => row[field]));
  }
})();
function phrase(term) {
  return `"${term.replaceAll('"', '""')}"`;
}
const caseData = await Bun.file(`${root}/native-cases.json`).json();
const terms = [
  ...new Set(caseData.flatMap((row) => row.terms)),
  manyTerms,
  "x".repeat(200),
  "a".repeat(200),
  ...manyTerms.split(" "),
];
const chars = [...'abc+%_[]\\"()!', "😀", "𐐨", "\uE000"];
let seed = 79;
const next = () => {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  return seed;
};
for (let i = 0; i < 200; i++) {
  let term = "";
  for (let j = 0, count = 3 + (next() % 18); j < count; j++) {
    term += chars[next() % chars.length];
  }
  terms.push(term);
  const row = {
    id: 1000 + i,
    title: `prefix${term}suffix`,
    content: term,
    description: "",
    tag1: "",
    tag2: "",
    collection: "",
  };
  records.push(row);
  insert.run(row.id, ...fields.map((field) => row[field]));
}
let checks = 0;
for (const term of terms) {
  if ([...term].length < 3) {
    continue;
  }
  for (const field of fields) {
    const expected = records
      .filter((row) => row[field].includes(term))
      .map((row) => row.id)
      .sort((a, b) => a - b);
    const actual = db
      .query(
        "SELECT rowid AS id FROM exact_fields WHERE exact_fields MATCH ? ORDER BY rowid"
      )
      .all(`${field}:${phrase(term)}`)
      .map((row) => row.id);
    assert.deepEqual(actual, expected, `${field} ${term}`);
    checks++;
  }
}
const expression = manyTerms
  .split(" ")
  .map((term) => `title:${phrase(term)}`)
  .join(" AND ");
assert.deepEqual(
  db
    .query("SELECT rowid AS id FROM exact_fields WHERE exact_fields MATCH ?")
    .all(expression),
  [{ id: 100 }]
);
const metadataStart = performance.now();
const metadata = db.query("SELECT id,title FROM bench ORDER BY id").all();
const saved = await Bun.file(`${root}/bitmap-cache.json`).json();
const index = new Map(
  saved.postings.map(([key, value]) => {
    const buffer = Buffer.from(value, "base64");
    return [
      key,
      new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4),
    ];
  })
);
const metadataLoadMs = performance.now() - metadataStart;
const buildStart = performance.now();
db.exec(
  "DROP TABLE IF EXISTS bench_fields; CREATE VIRTUAL TABLE bench_fields USING fts5(title,content,content='bench',content_rowid='id',tokenize='trigram case_sensitive 1'); INSERT INTO bench_fields(bench_fields) VALUES ('rebuild')"
);
const fieldIndexBuildMs = performance.now() - buildStart;
function hits(field, term) {
  if ([...term].length >= 3) {
    return new Set(
      db
        .query(
          "SELECT rowid AS id FROM bench_fields WHERE bench_fields MATCH ?"
        )
        .all(`${field}:${phrase(term)}`)
        .map((row) => row.id)
    );
  }
  const bits = index.get(JSON.stringify([field, term]));
  const ids = new Set();
  if (bits) {
    for (let slot = 0; slot < metadata.length; slot++) {
      if (bits[slot >>> 5] & (1 << (slot & 31))) ids.add(metadata[slot].id);
    }
  }
  return ids;
}
function search(query, sort) {
  const terms = [...new Set(query.split(" ").filter(Boolean))];
  const perTerm = terms.map((term) => ({
    title: hits("title", term),
    content: hits("content", term),
  }));
  const result = [];
  for (const row of metadata) {
    let titleCount = 0;
    let eligible = true;
    for (const hit of perTerm) {
      if (hit.title.has(row.id)) {
        titleCount++;
      } else if (!hit.content.has(row.id)) {
        eligible = false;
        break;
      }
    }
    if (eligible) {
      result.push({
        id: row.id,
        title: row.title,
        tier:
          row.title === query
            ? 1
            : titleCount === terms.length
              ? 2
              : titleCount > 0
                ? 3
                : 6,
      });
    }
  }
  result.sort(
    (a, b) =>
      (sort === "relevance" ? a.tier - b.tier : 0) ||
      Buffer.compare(Buffer.from(a.title), Buffer.from(b.title)) ||
      a.id - b.id
  );
  return result.slice(0, 50).map((row) => row.id);
}
const timings = [];
for (const query of [
  "🫠",
  "🫠x",
  "a",
  "ab",
  "common",
  "zzzzzz",
  "prompt common",
  "common a",
  manyTerms,
]) {
  for (const sort of ["title", "relevance"]) {
    const samples = [];
    let count;
    for (let run = 0; run < 21; run++) {
      const start = performance.now();
      count = search(query, sort).length;
      if (run > 0) {
        samples.push(performance.now() - start);
      }
    }
    samples.sort((a, b) => a - b);
    timings.push({
      query,
      sort,
      count,
      p50: samples[9],
      p95: samples[18],
      max: samples[19],
    });
  }
}
for (const query of ["🫠", "🫠x", "a", "ab", "common", "zzzzzz"]) {
  const expected = db
    .query(
      "SELECT id FROM bench WHERE instr(title,?)>0 OR instr(content,?)>0 ORDER BY title COLLATE BINARY,id LIMIT 50"
    )
    .all(query, query)
    .map((row) => row.id);
  assert.deepEqual(search(query, "title"), expected);
}
const sizes = db
  .query(
    "SELECT name,sum(pgsize) AS bytes FROM dbstat WHERE name LIKE 'bench_fields%' GROUP BY name"
  )
  .all();
const output = {
  perFieldExactChecks: checks,
  maxConjunctionCodePoints: [...manyTerms].length,
  maxConjunctionTerms: 50,
  maxLiteralCodePoints: 200,
  metadataLoadMs,
  fieldIndexBuildMs,
  sizes,
  timings,
};
await Bun.write(
  `${root}/field-fts-results.json`,
  JSON.stringify(output, null, 2)
);
process.stdout.write(JSON.stringify(output, null, 2));
db.close();
