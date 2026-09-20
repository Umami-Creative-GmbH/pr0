// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Samples and corpus writes run sequentially to avoid contaminating benchmark measurements.
import { SQL } from "bun";

const pg = new SQL(
  process.env.SEARCH_DATABASE_URL ??
    "postgres://postgres:search-research-only@127.0.0.1:55439/search_research"
);
await pg`CREATE INDEX IF NOT EXISTS bench_title_order ON bench(title COLLATE "C",id)`;
const output = [];
for (const q of ["🫠", "a", "ab", "common"]) {
  const samples = [];
  for (let run = 0; run < 21; run += 1) {
    const start = performance.now();
    await pg`SELECT id FROM bench WHERE strpos(title,${q})>0 OR strpos(content,${q})>0 ORDER BY title COLLATE "C",id LIMIT 50`;
    if (run > 0) {
      samples.push(performance.now() - start);
    }
  }
  samples.sort((a, b) => a - b);
  output.push({
    query: q,
    p50: samples[9],
    p95: samples[18],
    max: samples[19],
    plan: await pg`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM bench WHERE strpos(title,${q})>0 OR strpos(content,${q})>0 ORDER BY title COLLATE "C",id LIMIT 50`,
  });
}
await Bun.write(
  `${import.meta.dir}/ordered-index-results.json`,
  JSON.stringify(output, null, 2)
);
process.stdout.write(
  JSON.stringify(
    output.map(({ plan: _plan, ...other }) => other),
    null,
    2
  )
);
await pg.close();
