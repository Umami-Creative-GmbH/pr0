import { Database } from "bun:sqlite";
import { strict as assert } from "node:assert";

const root = import.meta.dir;
const source = new Database(`${root}/parity.sqlite`);
const fields = [
  "title",
  "content",
  "description",
  "tag1",
  "tag2",
  "collection",
];
const quote = (text) => `"${text.replaceAll('"', '""')}"`;
const grams = (term) => {
  const points = [...term];
  const unique = new Set();
  for (let i = 0; i + 2 < points.length; i += 1) {
    unique.add(points.slice(i, i + 3).join(""));
  }
  return [...unique].map(quote).join(" AND ");
};
const glob = (term) =>
  `*${[...term].map((point) => (point === "*" ? "[*]" : point === "?" ? "[?]" : point === "[" ? "[[]" : point === "]" ? "[]]" : point)).join("")}*`;
const small = new Database(`${root}/compact-parity.sqlite`, { create: true });
for (const field of fields) {
  small.exec(
    `DROP TABLE IF EXISTS f_${field}; CREATE VIRTUAL TABLE f_${field} USING fts5(value,tokenize='trigram case_sensitive 1',detail=none,columnsize=0)`
  );
}
const records = source
  .query(
    "SELECT rowid AS id,title,content,description,tag1,tag2,collection FROM exact_fields ORDER BY rowid"
  )
  .all();
records.push({
  id: 2000,
  title: "* ? [ ] [] [*] [?] [abc] back\\slash C++ 100% under_score",
  content: "abcXXbcd *x? [literal] 😀a😀",
  description: "",
  tag1: "",
  tag2: "",
  collection: "",
});
small.transaction(() => {
  for (const record of records) {
    for (const field of fields)
      small
        .query(`INSERT INTO f_${field}(rowid,value) VALUES(?,?)`)
        .run(record.id, record[field]);
  }
})();
const oldCases = await Bun.file(`${root}/native-cases.json`).json();
const terms = [
  ...new Set([
    ...oldCases.flatMap((row) => row.terms),
    ...records
      .filter((row) => row.id >= 1000 && row.id < 2000)
      .map((row) => row.content),
    "*",
    "?",
    "[",
    "]",
    "[]",
    "[*]",
    "[?]",
    "[abc]",
    "*x?",
    "[literal]",
    "abcd",
    "😀a😀",
    "x".repeat(200),
    "a".repeat(200),
  ]),
];
let parityChecks = 0;
for (const term of terms) {
  for (const field of fields) {
    const expected = records
      .filter((row) => row[field].includes(term))
      .map((row) => row.id);
    const long = [...term].length >= 3;
    const result = small
      .query(
        `SELECT rowid AS id FROM f_${field} WHERE ${long ? `f_${field} MATCH ? AND ` : ""}instr(value,?)>0 ORDER BY rowid`
      )
      .all(...(long ? [grams(term)] : []), term)
      .map((row) => row.id);
    assert.deepEqual(result, expected);
    const globResult = small
      .query(
        `SELECT rowid AS id FROM f_${field} WHERE value GLOB ? ORDER BY rowid`
      )
      .all(glob(term))
      .map((row) => row.id);
    assert.deepEqual(globResult, expected, `GLOB ${term}`);
    parityChecks += 2;
  }
}
const wrongCandidate = small
  .query("SELECT rowid AS id FROM f_content WHERE f_content MATCH ?")
  .all(grams("abcd"))
  .map((row) => row.id);
assert.ok(wrongCandidate.includes(2000));
assert.ok(
  !small
    .query(
      "SELECT rowid AS id FROM f_content WHERE f_content MATCH ? AND instr(value,?)>0"
    )
    .all(grams("abcd"), "abcd")
    .map((row) => row.id)
    .includes(2000)
);
process.stdout.write(
  `Compact candidate/recheck and escaped GLOB passed ${parityChecks} field cases.\n`
);
small.close();
const saved = await Bun.file(`${root}/bitmap-cache.json`).json();
const originalIndex = new Map(
  saved.postings.map(([key, value]) => {
    const bytes = Buffer.from(value, "base64");
    return [
      key,
      new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4),
    ];
  })
);
const report = { parityChecks, falsePositiveRecheckProven: true, corpora: [] };
for (const corpus of ["noise", "synthetic-prose"]) {
  const path = `${root}/compact-${corpus}.sqlite`;
  const db = new Database(path, { create: true });
  db.exec(
    "PRAGMA page_size=4096; PRAGMA cache_size=-65536; DROP TABLE IF EXISTS prompts; DROP TABLE IF EXISTS f_title; DROP TABLE IF EXISTS f_content; CREATE TABLE prompts(id INTEGER PRIMARY KEY,title TEXT,content TEXT); CREATE VIRTUAL TABLE f_title USING fts5(title,content='prompts',content_rowid='id',tokenize='trigram case_sensitive 1',detail=none,columnsize=0); CREATE VIRTUAL TABLE f_content USING fts5(content,content='prompts',content_rowid='id',tokenize='trigram case_sensitive 1',detail=none,columnsize=0)"
  );
  const rows = source
    .query("SELECT id,title,content FROM bench ORDER BY id")
    .all();
  if (corpus === "synthetic-prose") {
    const sentences = [
      "write a concise answer with useful examples and clear steps. ",
      "review the following document and identify important changes. ",
      "explain the reasoning and preserve exact names and punctuation. ",
      "summarize the meeting notes into actions with owners and dates. ",
      "translate the email into german while keeping the requested tone. ",
      "compare options and show practical advantages and limitations. ",
      "create a reusable prompt for research planning and editing. ",
    ];
    for (const row of rows) {
      const { length } = row.content;
      let value = "common ";
      let count = 0;
      while (value.length < length) {
        value += `${sentences[(row.id + count) % sentences.length]}reference${row.id % 97} section${count % 31}. `;
        count += 1;
      }
      row.content = value.slice(0, length);
    }
  }
  const importStart = performance.now();
  db.transaction(() => {
    const put = db.prepare("INSERT INTO prompts VALUES(?,?,?)");
    for (const row of rows) {
      put.run(row.id, row.title, row.content);
    }
  })();
  const importMs = performance.now() - importStart;
  const buildStart = performance.now();
  db.exec(
    "INSERT INTO f_title(f_title) VALUES('rebuild'); INSERT INTO f_content(f_content) VALUES('rebuild'); INSERT INTO f_title(f_title) VALUES('optimize'); INSERT INTO f_content(f_content) VALUES('optimize')"
  );
  const indexBuildMs = performance.now() - buildStart;
  const index = corpus === "noise" ? originalIndex : new Map();
  if (corpus !== "noise") {
    for (let slot = 0; slot < rows.length; slot += 1) {
      for (const field of ["title", "content"]) {
        const unique = new Set();
        let previous = "";
        for (const point of rows[slot][field]) {
          unique.add(point);
          if (previous) {
            unique.add(previous + point);
          }
          previous = point;
        }
        for (const gram of unique) {
          const key = JSON.stringify([field, gram]);
          let bits = index.get(key);
          if (!bits) {
            bits = new Uint32Array(313);
            index.set(key, bits);
          }
          bits[slot >>> 5] |= 1 << (slot & 31);
        }
      }
    }
  }
  const metadata = rows.map((row) => ({
    id: row.id,
    title: row.title,
    titleBytes: Buffer.from(row.title),
  }));
  // Do not retain the content cache in the measured query algorithm.
  const shortHits = (field, term) => {
    const bits = index.get(JSON.stringify([field, term]));
    const found = new Set();
    if (bits) {
      for (let slot = 0; slot < metadata.length; slot += 1)
        if (bits[slot >>> 5] & (1 << (slot & 31))) found.add(metadata[slot].id);
    }
    return found;
  };
  const termHits = (field, term, method) => {
    if ([...term].length < 3) {
      return shortHits(field, term);
    }
    const table = `f_${field}`;
    const rows =
      method === "glob"
        ? db
            .query(`SELECT rowid AS id FROM ${table} WHERE ${field} GLOB ?`)
            .all(glob(term))
        : db
            .query(
              `SELECT rowid AS id FROM ${table} WHERE ${table} MATCH ? AND instr(${field},?)>0`
            )
            .all(grams(term), term);
    return new Set(rows.map((row) => row.id));
  };
  const search = (query, sort, method) => {
    const terms = [...new Set(query.split(" ").filter(Boolean))];
    const sets = terms.map((term) => ({
      title: termHits("title", term, method),
      content: termHits("content", term, method),
    }));
    const result = [];
    for (const row of metadata) {
      let titleCount = 0;
      let eligible = true;
      for (const hit of sets) {
        if (hit.title.has(row.id)) {
          titleCount += 1;
        } else if (!hit.content.has(row.id)) {
          eligible = false;
          break;
        }
      }
      if (eligible) {
        result.push({
          id: row.id,
          titleBytes: row.titleBytes,
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
        Buffer.compare(a.titleBytes, b.titleBytes) ||
        a.id - b.id
    );
    return result.slice(0, 50).map((row) => row.id);
  };
  const queries = [
    "🫠",
    "🫠x",
    "a",
    "ab",
    "common",
    "zzzzzz",
    "prompt common",
    "common a",
    "punctuation",
    "important changes",
    "reference96",
  ];
  const timings = [];
  for (const method of ["match-recheck", "glob"]) {
    for (const query of queries)
      for (const sort of ["title", "relevance"]) {
        const samples = [];
        let found;
        for (let run = 0; run < 21; run += 1) {
          const start = performance.now();
          found = search(query, sort, method);
          if (run > 0) samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        const terms = query.split(" ");
        const eligible = rows
          .filter((row) =>
            terms.every(
              (term) => row.title.includes(term) || row.content.includes(term)
            )
          )
          .map((row) => {
            const titleMatches = terms.filter((term) =>
              row.title.includes(term)
            ).length;
            return {
              ...row,
              tier:
                row.title === query
                  ? 1
                  : titleMatches === terms.length
                    ? 2
                    : titleMatches > 0
                      ? 3
                      : 6,
            };
          });
        eligible.sort(
          (a, b) =>
            (sort === "relevance" ? a.tier - b.tier : 0) ||
            Buffer.compare(Buffer.from(a.title), Buffer.from(b.title)) ||
            a.id - b.id
        );
        assert.deepEqual(
          found,
          eligible.slice(0, 50).map((row) => row.id)
        );
        timings.push({
          method,
          query,
          sort,
          count: found.length,
          p50: samples[9],
          p95: samples[18],
          max: samples[19],
        });
      }
  }
  const sizes = db
    .query("SELECT name,sum(pgsize) AS bytes FROM dbstat GROUP BY name")
    .all();
  const indexBytes = sizes
    .filter((row) => row.name.startsWith("f_"))
    .reduce((sum, row) => sum + row.bytes, 0);
  const tableBytes = sizes
    .filter((row) => !row.name.startsWith("f_"))
    .reduce((sum, row) => sum + row.bytes, 0);
  const shortPostingPayloadBytes = [...index.values()].reduce(
    (sum, bits) => sum + bits.byteLength,
    0
  );
  const plans = {
    glob: db
      .query(
        "EXPLAIN QUERY PLAN SELECT rowid FROM f_content WHERE content GLOB ?"
      )
      .all("*common*"),
    match: db
      .query(
        "EXPLAIN QUERY PLAN SELECT rowid FROM f_content WHERE f_content MATCH ? AND instr(content,?)>0"
      )
      .all(grams("common"), "common"),
  };
  const result = {
    corpus,
    logicalBytes: 104_857_600,
    rows: 10_000,
    cacheKiB: 65_536,
    importMs,
    indexBuildMs,
    indexBytes,
    tableBytes,
    totalUsedBytes: indexBytes + tableBytes,
    shortPostingPayloadBytes,
    sizes,
    plans,
    timings,
  };
  report.corpora.push(result);
  await Bun.write(
    `${root}/compact-results.json`,
    JSON.stringify(report, null, 2)
  );
  process.stdout.write(
    `${JSON.stringify({ corpus, indexBytes, tableBytes, indexBuildMs, shortPostingPayloadBytes, selected: timings.filter((row) => row.sort === "relevance" && ["common", "zzzzzz", "prompt common", "punctuation"].includes(row.query)) }, null, 2)}\n`
  );
  db.close();
}
source.close();
