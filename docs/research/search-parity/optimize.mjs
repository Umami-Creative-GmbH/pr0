import { Database } from "bun:sqlite";

const db = new Database(`${import.meta.dir}/parity.sqlite`);
const start = performance.now();
db.exec("INSERT INTO bench_fields(bench_fields) VALUES('optimize')");
const result = {
  optimizeMs: performance.now() - start,
  sizes: db
    .query(
      "SELECT name,sum(pgsize) AS bytes FROM dbstat WHERE name LIKE 'bench_fields%' GROUP BY name"
    )
    .all(),
};
await Bun.write(
  `${import.meta.dir}/field-fts-optimize-results.json`,
  JSON.stringify(result, null, 2)
);
process.stdout.write(JSON.stringify(result, null, 2));
db.close();
