import { Database } from "bun:sqlite";
import { strict as assert } from "node:assert";

const root = import.meta.dir;
const quote = (v) => `"${v.replaceAll('"', '""')}"`;
const grams = (term) => {
  const points = [...term];
  const result = new Set();
  for (let i = 0; i + 2 < points.length; i += 1) {
    result.add(points.slice(i, i + 3).join(""));
  }
  return [...result].map(quote).join(" AND ");
};
const output = [];
for (const corpus of ["noise", "synthetic-prose"]) {
  const db = new Database(`${root}/compact-${corpus}.sqlite`);
  db.exec("PRAGMA cache_size=-65536");
  const metadata = db
    .query("SELECT id,title FROM prompts ORDER BY id")
    .all()
    .map((row) => ({ ...row, key: Buffer.from(row.title) }));
  const rows = db
    .query("SELECT id,title,content FROM prompts ORDER BY id")
    .all();
  const sizesById = new Map(
    rows.map((row) => [row.id, Buffer.byteLength(row.content)])
  );
  const short = new Map();
  for (const row of rows) {
    for (const field of ["title", "content"]) {
      const unique = new Set();
      let previous = "";
      for (const point of row[field]) {
        unique.add(point);
        if (previous) {
          unique.add(previous + point);
        }
        previous = point;
      }
      for (const gram of unique) {
        const key = `${field}\t${gram}`;
        let set = short.get(key);
        if (!set) {
          set = new Set();
          short.set(key, set);
        }
        set.add(row.id);
      }
    }
  }
  const perTermCandidates = (field, term) =>
    [...term].length < 3
      ? (short.get(`${field}\t${term}`) ?? new Set())
      : new Set(
          db
            .query(
              `SELECT rowid AS id FROM f_${field} WHERE f_${field} MATCH ?`
            )
            .all(grams(term))
            .map((row) => row.id)
        );
  function search(query, sort, method) {
    const terms = [...new Set(query.split(" ").filter(Boolean))];
    const coarse = terms.map((term) => ({
      term,
      title: perTermCandidates("title", term),
      content: perTermCandidates("content", term),
    }));
    const candidates = [];
    for (const row of metadata) {
      if (
        !coarse.every((hit) => hit.title.has(row.id) || hit.content.has(row.id))
      ) {
        continue;
      }
      const titleCount = terms.filter((term) =>
        row.title.includes(term)
      ).length;
      const tier =
        row.title === query
          ? 1
          : titleCount === terms.length
            ? 2
            : titleCount > 0
              ? 3
              : 6;
      candidates.push({ ...row, tier });
    }
    candidates.sort(
      (a, b) =>
        (sort === "relevance" ? a.tier - b.tier : 0) ||
        Buffer.compare(a.key, b.key) ||
        a.id - b.id
    );
    const result = [];
    let rechecked = 0;
    if (method === "ordered" || method === "batched") {
      const get = db.prepare("SELECT content FROM prompts WHERE id=?");
      let chunkStop = -1;
      let chunkBodies = new Map();
      for (const [candidateIndex, row] of candidates.entries()) {
        let content;
        const eligible = coarse.every((hit) => {
          if (row.title.includes(hit.term)) {
            return true;
          }
          if (!hit.content.has(row.id)) {
            return false;
          }
          if ([...hit.term].length <= 3) {
            return true;
          }
          if (content === undefined) {
            if (method === "batched") {
              if (candidateIndex >= chunkStop) {
                const batch = [];
                let bytes = 0;
                for (
                  let i = candidateIndex;
                  i < candidates.length && batch.length < 64;
                  i += 1
                ) {
                  const next = candidates[i];
                  const size = sizesById.get(next.id);
                  if (batch.length && bytes + size > 4 * 1024 * 1024) {
                    break;
                  }
                  batch.push(next.id);
                  bytes += size;
                }
                chunkStop = candidateIndex + batch.length;
                chunkBodies = new Map(
                  db
                    .query(
                      `SELECT id,content FROM prompts WHERE id IN (${batch.join(",")})`
                    )
                    .all()
                    .map((value) => [value.id, value.content])
                );
              }
              content = chunkBodies.get(row.id);
            } else {
              content = get.get(row.id).content;
            }
            rechecked += 1;
          }
          return content.includes(hit.term);
        });
        if (eligible) {
          result.push(row.id);
        }
        if (result.length === 50) {
          break;
        }
      }
    } else {
      const sql = `SELECT id,${terms
        .map(() => "(instr(title,?)>0 OR instr(content,?)>0)")
        .map((v, i) => `${v} AS hit${i}`)
        .join(
          ","
        )} FROM prompts WHERE id IN (${candidates.map((row) => row.id).join(",") || "NULL"})`;
      const values = terms.flatMap((term) => [term, term]);
      const checked = db.query(sql).all(...values);
      rechecked = candidates.length;
      const eligible = new Set(
        checked
          .filter((row) => terms.every((_, i) => row[`hit${i}`]))
          .map((row) => row.id)
      );
      for (const row of candidates) {
        if (eligible.has(row.id)) {
          result.push(row.id);
        }
        if (result.length === 50) {
          break;
        }
      }
    }
    return { ids: result, rechecked, candidates: candidates.length };
  }
  const longQuery =
    "write concise answer useful examples clear steps review following document identify important changes explain reasoning preserve exact names punctuation summarize meeting notes actions owners dates";
  const queries = [
    "🫠",
    "a",
    "common",
    "zzzzzz",
    "prompt common",
    "important changes",
    "reference96",
    longQuery,
  ];
  for (const method of process.env.COMPACT_BATCH === "1"
    ? ["batched"]
    : ["fused", "ordered"]) {
    for (const query of queries)
      for (const sort of ["title", "relevance"]) {
        const samples = [];
        let actual;
        for (let run = 0; run < 21; run += 1) {
          const start = performance.now();
          actual = search(query, sort, method);
          if (run > 0) samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        const terms = [...new Set(query.split(" "))];
        const oracle = rows
          .filter((row) =>
            terms.every(
              (term) => row.title.includes(term) || row.content.includes(term)
            )
          )
          .map((row) => {
            const n = terms.filter((term) => row.title.includes(term)).length;
            return {
              ...row,
              tier:
                row.title === query
                  ? 1
                  : n === terms.length
                    ? 2
                    : n > 0
                      ? 3
                      : 6,
            };
          });
        oracle.sort(
          (a, b) =>
            (sort === "relevance" ? a.tier - b.tier : 0) ||
            Buffer.compare(Buffer.from(a.title), Buffer.from(b.title)) ||
            a.id - b.id
        );
        assert.deepEqual(
          actual.ids,
          oracle.slice(0, 50).map((row) => row.id)
        );
        output.push({
          corpus,
          method,
          query,
          codePoints: [...query].length,
          sort,
          ...actual,
          p50: samples[9],
          p95: samples[18],
          max: samples[19],
        });
      }
  }
  await Bun.write(
    `${root}/${process.env.COMPACT_BATCH === "1" ? "compact-batched-results" : "compact-ordered-results"}.json`,
    JSON.stringify(output, null, 2)
  );
  process.stdout.write(
    `${JSON.stringify(
      output
        .filter((row) => row.corpus === corpus && row.sort === "relevance")
        .map(({ ids, ...row }) => row),
      null,
      2
    )}\n`
  );
  db.close();
}
