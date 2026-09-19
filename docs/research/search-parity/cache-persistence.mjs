import { Database } from "bun:sqlite";
import { strict as assert } from "node:assert";

const root = import.meta.dir;
const source = new Database(`${root}/parity.sqlite`);
const rows = source
  .query("SELECT id,title,content FROM bench ORDER BY id")
  .all();
const wordCount = Math.ceil(rows.length / 32);
const postings = new Map();
function grams(text) {
  const all = new Set();
  let prev = "";
  for (const point of text) {
    all.add(point);
    if (prev) {
      all.add(prev + point);
    }
    prev = point;
  }
  return all;
}
const build = performance.now();
for (let slot = 0; slot < rows.length; slot++) {
  for (const field of ["title", "content"]) {
    for (const gram of grams(rows[slot][field])) {
      const key = JSON.stringify([field, gram]);
      let bits = postings.get(key);
      if (!bits) {
        bits = new Uint32Array(wordCount);
        postings.set(key, bits);
      }
      bits[slot >>> 5] |= 1 << (slot & 31);
    }
  }
}
const buildMs = performance.now() - build;
const serializeStart = performance.now();
const payload = JSON.stringify({
  normalization: "pr0-search-v1-ucd17",
  revision: 1,
  slots: rows.map((row) => row.id),
  postings: [...postings].map(([key, bits]) => [
    key,
    Buffer.from(bits.buffer).toString("base64"),
  ]),
});
await Bun.write(`${root}/bitmap-cache.json`, payload);
const persistMs = performance.now() - serializeStart;
const restoreSamples = [];
for (let run = 0; run < 21; run++) {
  const begin = performance.now();
  const saved = await Bun.file(`${root}/bitmap-cache.json`).json();
  const restored = new Map(
    saved.postings.map(([key, value]) => [key, Buffer.from(value, "base64")])
  );
  assert.equal(restored.size, postings.size);
  if (run > 0) {
    restoreSamples.push(performance.now() - begin);
  }
}
restoreSamples.sort((a, b) => a - b);
Bun.gc(true);
const memory = process.memoryUsage();
const db = new Database(`${root}/cache-save.sqlite`, { create: true });
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; DROP TABLE IF EXISTS prompt; DROP TABLE IF EXISTS prompt_fts; DROP TABLE IF EXISTS short_posting; DROP TABLE IF EXISTS outbox; DROP TABLE IF EXISTS cache_meta; CREATE TABLE prompt(id INTEGER PRIMARY KEY,content TEXT); CREATE VIRTUAL TABLE prompt_fts USING fts5(content,content='prompt',content_rowid='id',tokenize='trigram case_sensitive 1'); CREATE TABLE short_posting(key TEXT PRIMARY KEY,bits BLOB); CREATE TABLE outbox(id INTEGER PRIMARY KEY,variant TEXT); CREATE TABLE cache_meta(version TEXT,revision INTEGER); INSERT INTO cache_meta VALUES ('pr0-search-v1-ucd17',1)"
);
const put = db.prepare("INSERT OR REPLACE INTO short_posting VALUES(?,?)");
db.transaction(() => {
  for (const [key, bits] of postings) {
    put.run(key, new Uint8Array(bits.buffer));
  }
})();
let previous = "abcdefghijklmnopqrstuvwxyz".repeat(10_083).slice(0, 256 * 1024);
db.query("INSERT INTO prompt VALUES(1,?)").run(previous);
db.exec("INSERT INTO prompt_fts(prompt_fts) VALUES ('rebuild')");
const saves = [];
for (let run = 0; run < 21; run++) {
  const next = previous.slice(0, -1) + (run % 2 ? "x" : "y");
  const begin = performance.now();
  const touched = new Set([...grams(previous), ...grams(next)]);
  db.transaction(() => {
    db.query(
      "INSERT INTO prompt_fts(prompt_fts,rowid,content) VALUES ('delete',1,?)"
    ).run(previous);
    db.query("UPDATE prompt SET content=? WHERE id=1").run(next);
    db.query("INSERT INTO prompt_fts(rowid,content) VALUES(1,?)").run(next);
    // Rewrite all existing content posting pages as a conservative I/O allowance.
    for (const [key, bits] of postings) {
      if (key.startsWith('["content",')) {
        put.run(key, new Uint8Array(bits.buffer));
      }
    }
    db.query("INSERT INTO outbox VALUES(?,?)").run(run, next);
    db.query("UPDATE cache_meta SET revision=revision+1").run();
  })();
  const ms = performance.now() - begin;
  if (run > 0) {
    saves.push(ms);
  }
  previous = next;
  assert.equal(touched.size > 0, true);
}
saves.sort((a, b) => a - b);
assert.equal(db.query("SELECT count(*) AS n FROM outbox").get().n, 21);
const output = {
  buildMs,
  persistMs,
  serializedBytes: Buffer.byteLength(payload),
  bitmapKeys: postings.size,
  restoreMs: {
    p50: restoreSamples[9],
    p95: restoreSamples[18],
    max: restoreSamples[19],
  },
  memoryAfterGc: memory,
  durable256KiBSaveMs: { p50: saves[9], p95: saves[18], max: saves[19] },
  limitations:
    "Synthetic I/O allowance: rewrites posting pages without computing correct membership mutation; no claim of full incremental-index correctness. WAL/FULL transaction includes full text, positional FTS delete+insert, posting writes, full variant outbox, cache revision. One prompt, no production quotas or schema.",
};
await Bun.write(`${root}/cache-results.json`, JSON.stringify(output, null, 2));
process.stdout.write(JSON.stringify(output, null, 2));
db.close();
source.close();
