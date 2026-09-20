// oxlint-disable eslint/no-bitwise -- Bitmap membership and seeded PRNGs require exact 32-bit operations.
// oxlint-disable eslint/no-nested-ternary -- Ordered expressions preserve the reference ranking and comparison branches used by these recorded experiments.
import { Database } from "bun:sqlite";
import { strict as assert } from "node:assert";

const start = performance.now();
const before = process.memoryUsage();
const db = new Database(`${import.meta.dir}/parity.sqlite`);
const rows = db.query("SELECT id,title,content FROM bench ORDER BY id").all();
const hydrateMs = performance.now() - start;
const words = Math.ceil(rows.length / 32);
const index = { title: new Map(), content: new Map() };
const grams = (text) => {
  const result = new Set();
  let previous = "";
  for (const point of text) {
    result.add(point);
    if (previous) {
      result.add(previous + point);
    }
    previous = point;
  }
  return result;
};
const add = (map, gram, id) => {
  let bits = map.get(gram);
  if (!bits) {
    bits = new Uint32Array(words);
    map.set(gram, bits);
  }
  bits[id >>> 5] |= 1 << (id & 31);
};
const buildStart = performance.now();
for (let i = 0; i < rows.length; i += 1) {
  for (const field of ["title", "content"]) {
    for (const gram of grams(rows[i][field])) {
      add(index[field], gram, i);
    }
  }
}
const buildMs = performance.now() - buildStart;
const after = process.memoryUsage();
const encoder = new TextEncoder();
const titleKeys = rows.map((row) => encoder.encode(row.title));
const present = (bits, id) =>
  bits ? Boolean(bits[id >>> 5] & (1 << (id & 31))) : false;
const search = (query, sort) => {
  const terms = query.split(" ").filter(Boolean);
  const fieldHits = terms.map((term) => ({
    term,
    short: [...term].length <= 2,
    title: index.title.get(term),
    content: index.content.get(term),
  }));
  const result = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    let titleCount = 0;
    let matches = true;
    for (const hit of fieldHits) {
      const titleMatch = hit.short
        ? present(hit.title, i)
        : row.title.includes(hit.term);
      const contentMatch = titleMatch
        ? false
        : hit.short
          ? present(hit.content, i)
          : row.content.includes(hit.term);
      if (!(titleMatch || contentMatch)) {
        matches = false;
        break;
      }
      if (titleMatch) {
        titleCount += 1;
      }
    }
    if (matches) {
      const tier =
        row.title === query
          ? 1
          : titleCount === terms.length
            ? 2
            : titleCount > 0
              ? 3
              : 6;
      result.push({ i, id: row.id, tier });
    }
  }
  result.sort(
    (a, b) =>
      (sort === "relevance" ? a.tier - b.tier : 0) ||
      Buffer.compare(titleKeys[a.i], titleKeys[b.i]) ||
      a.id - b.id
  );
  return result.slice(0, 50).map((row) => row.id);
};
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
]) {
  for (const sort of ["title", "relevance"]) {
    const samples = [];
    let result;
    for (let run = 0; run < 21; run += 1) {
      const begin = performance.now();
      result = search(query, sort);
      const ms = performance.now() - begin;
      if (run > 0) {
        samples.push(ms);
      }
    }
    samples.sort((a, b) => a - b);
    timings.push({
      query,
      sort,
      count: result.length,
      min: samples[0],
      p50: samples[9],
      p95: samples[18],
      max: samples[19],
    });
  }
}
// Original SQL scan sorted by title is an independent oracle for these cases.
for (const query of ["🫠", "🫠x", "a", "ab", "common", "zzzzzz"]) {
  const expected = db
    .query(
      "SELECT id FROM bench WHERE instr(title,?)>0 OR instr(content,?)>0 ORDER BY title COLLATE BINARY,id LIMIT 50"
    )
    .all(query, query)
    .map((row) => row.id);
  assert.deepEqual(search(query, "title"), expected);
}
const huge = `common ${"abcdefghijklmnopqrstuvwxyz"
  .repeat(10_083)
  .slice(0, 256 * 1024 - 7)}`;
const saveSamples = [];
for (let run = 0; run < 21; run += 1) {
  const begin = performance.now();
  const old = grams(rows[0].content);
  const replacement = grams(huge);
  for (const gram of old) {
    index.content.get(gram)[0] &= ~1;
  }
  for (const gram of replacement) {
    add(index.content, gram, 0);
  }
  rows[0].content = huge;
  const ms = performance.now() - begin;
  if (run > 0) {
    saveSamples.push(ms);
  }
}
saveSamples.sort((a, b) => a - b);
const bitmapBytes = [...index.title.values(), ...index.content.values()].reduce(
  (sum, bits) => sum + bits.byteLength,
  0
);
const output = {
  hydrateMs,
  buildMs,
  rows: rows.length,
  textBytes: 100 * 1024 * 1024,
  before,
  after,
  indexKeys: { title: index.title.size, content: index.content.size },
  bitmapBytes,
  maximumPromptIndexUpdateMs: {
    p50: saveSamples[9],
    p95: saveSamples[18],
    max: saveSamples[19],
  },
  timings,
  limitations:
    "Warm in-process proof; memory index update excludes durable SQLite/FTS/outbox commit. Native/Rust/WASM implementation and multi-library eviction/concurrency still need design.",
};
await Bun.write(
  `${import.meta.dir}/memory-index-results.json`,
  JSON.stringify(output, null, 2)
);
process.stdout.write(
  JSON.stringify(
    {
      hydrateMs,
      buildMs,
      bitmapBytes,
      rssDelta: after.rss - before.rss,
      timings,
      update: output.maximumPromptIndexUpdateMs,
    },
    null,
    2
  )
);
db.close();
