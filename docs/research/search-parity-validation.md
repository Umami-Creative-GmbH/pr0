# Literal substring search parity and bounded performance

Research for [Validate literal substring search across PostgreSQL and SQLite](https://github.com/Umami-Creative-GmbH/pr0/issues/15), investigated 2026-09-19. This records isolated experiments, not a production engine or a release-performance certification. The accepted [search behavior](https://github.com/Umami-Creative-GmbH/pr0/issues/7#issuecomment-5742642457), [capacity envelope](https://github.com/Umami-Creative-GmbH/pr0/issues/8#issuecomment-5742705995), and [storage foundation](https://github.com/Umami-Creative-GmbH/pr0/issues/10#issuecomment-5742823054) remain authoritative.

## Finding

Literal matching is feasible without changing punctuation, short-query, cross-field AND, or deterministic ordering rules. **Trigram indexes alone are not a sufficient performance design.** The first maximum-library query path missed the 150 ms budget before UI/debounce/network costs. An additional experiment found a promising route through exact short-term postings, cached normalized fields, compact metadata, and appropriate ordering indexes. The final addendum turns that exploratory route into a concrete positional/posting candidate with bounded caches and revision fencing. Its server deployment and revised provisional disk allocation require the human architecture choice; integration and supported-workload guarantees remain named implementation/release tests.

All 39 adversarial query cases agreed in PostgreSQL, Bun SQLite, and Rust bundled SQLite. The six accepted relevance tiers agreed in a separate PostgreSQL/SQLite fixture. The raw [parity results](search-parity/results.json), [Rust results](search-parity/native-results.json), [ranking results](search-parity/ranking-results.json), and executable harnesses accompany this report. Rust consumed the same normalized fixtures; it did **not** independently implement the Unicode normalizer.

## Exact semantics and index boundaries

Use independently normalized searchable fields. For each whitespace-delimited query term, require a literal occurrence in at least one title/content/description/tag/collection value; AND the terms. Preserve field membership for ranking. Do not join organization names without a separator or allow a term to bridge field boundaries. Deduplicate equal normalized terms. SQL values are bound parameters; SQL parameterization alone does not escape pattern or FTS query syntax.

PostgreSQL `pg_trgm` ignores punctuation when forming its index keys. This does not make escaped `LIKE` punctuation-insensitive: the real predicate still verifies the pattern. The harness binds `%<escaped literal>%`, escaping backslash, percent and underscore, with explicit `ESCAPE '\'`; a separate per-field `strpos` check is the semantic oracle. GIN/GiST candidates and similarity operators are not the accepted relevance tiers. Patterns without useful trigrams may scan broadly. A two-code-point term is not automatically unindexable in PostgreSQL: punctuation/word-boundary extraction made `🫠x` selective in the recorded plan. [pg_trgm](https://www.postgresql.org/docs/17/pgtrgm.html), [pattern matching](https://www.postgresql.org/docs/17/functions-matching.html).

For SQLite, the experiment uses full-detail FTS5 `trigram case_sensitive 1` over already normalized text. It constructs a quoted FTS phrase for each eligible term, doubling embedded double quotes; it never passes raw user syntax. Terms shorter than three code points are omitted from the FTS restriction and checked exactly with `instr`. Such raw short-term MATCH queries returned no results, despite qualifying rows. Adding `ESCAPE` to SQLite LIKE prevents its trigram LIKE optimization; recorded plans distinguish `M1`, `L0`, and an unoptimized virtual-table scan. External-content indexes must be maintained with the corresponding records in the same transaction. These facts rule out copying one backend's query literally into the other. [FTS5 trigram and external content documentation](https://www.sqlite.org/fts5.html#the_trigram_tokenizer).

The 39 cases include blank/whitespace queries, one/two-code-point terms, C++, percent, underscore, backslash, brackets, quotes, OR/AND/NOT as ordinary text, composed/decomposed accents, sharp s, Greek sigma forms, dotted I, Deseret case, emoji, cross-field AND, and a term that would match only if two fields were incorrectly concatenated. Inputs containing lone surrogates and U+0000 are rejected by the proposed normalizer. PostgreSQL's text parameter rejected U+0000 as well; do not silently strip it or let desktop accept text the server cannot represent. [PostgreSQL character types](https://www.postgresql.org/docs/17/datatype-character.html).

## Recommended shared contract, awaiting architectural acceptance

Version this as `pr0-search-v1-ucd17`, using Unicode **17.0.0** data:

1. Validate Unicode scalar values and reject U+0000 before accepting searchable text.
2. Canonically decompose with NFD; apply default full case folding using CaseFolding C/F mappings, excluding Turkic T mappings; apply NFD again.
3. Remove only characters that are both Unicode General_Category Mark and Diacritic=Yes. This strips decomposed accents while retaining variation selectors and unrelated marks. Do not remove all punctuation, use locale-sensitive lowercasing, or apply NFKD compatibility normalization. Full case folding itself includes mappings such as sharp s and some ligatures; that is explicit caseless matching, not a general transliterator. `ueber` remains different from `uber`.
4. Map Unicode White_Space runs to one ASCII space, trim that space at the ends, and split nonblank queries on it. Keep raw stored text and identity rules unchanged.
5. Compare normalized titles lexicographically by Unicode scalar value, equivalently unsigned lexicographic UTF-8 bytes for valid scalar text. Use PostgreSQL UTF8 `COLLATE "C"`, SQLite UTF8 `COLLATE BINARY`, and an explicit byte/scalar comparator in application code. Default JavaScript UTF-16 comparison **failed** the supplementary-character ordering fixture. Canonical lowercase UUID text or 16-byte UUID order can provide the final stable identity tie-breaker; pick one representation consistently.

The harness was run with Bun 1.4.2's reported Unicode 17.0 / ICU 78.3 and fetches Unicode 17.0.0 CaseFolding data (SHA-256 recorded). Production needs a single shared implementation or generated version-pinned Rust/TypeScript tables plus Unicode conformance fixtures; relying on whichever ICU a browser ships is insufficient. Persist the normalization version with derived indexes. A version change requires rebuilding derived state before serving the new contract and must preserve authoritative text/outbox data. [Unicode normalization](https://www.unicode.org/reports/tr15/), [CaseFolding 17.0.0](https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt), [Unicode property data](https://www.unicode.org/Public/17.0.0/ucd/PropList.txt), [SQLite collations](https://www.sqlite.org/datatype3.html#collation).

Implement the six tiers explicitly from per-field term matches; use the accepted use/modification/title/identity tuple, not BM25 or trigram similarity. The ranking fixture covers all six tiers with equal dates. It does not implement every date/null/filter combination.

For pagination, recommend an opaque cursor binding instance/account, normalized query/filter/sort fingerprint, normalization version, library search revision, and the last complete sort tuple. Use keyset continuation, explicit null ordering, and the same comparator. Invalidate/restart when the relevant library revision changes, retaining selected identity if still eligible. This avoids pretending a cursor over mutable data is a stable snapshot. Do not hold a database transaction open while a user browses. These cursor and invalidation rules are recommendations, not implemented tests; issue 10 must accept their observable restart behavior.

## Recorded environment and baseline measurements

Windows host: AMD Ryzen AI Max+ Pro 395, 16 cores/32 logical processors, 102,838,435,840 bytes physical memory. Bun 1.4.2; native Rust/Cargo 1.94.0 with `rusqlite=0.40.2`, bundled SQLite 3.53.2. Bun's SQLite is also 3.53.2. PostgreSQL **17.10**, pg_trgm 1.6, UTF8, Docker Alpine image digest `sha256:979c4379dd698aba0b890599a6104e082035f98ef31d9b9291ec22f2b13059ca`. The container used its defaults, including default shared buffers; host OS caches and other research activity were uncontrolled. Native final results use an optimized release build and ran after the main benchmark.

Fixture: exactly 10,000 rows and 104,857,600 bytes of logical title/content, deterministic random lower-case body text prefixed with `common`, compact distinct titles. Search projections duplicate text and indexes consume additional space. Each timing is 20 measured runs after one warmup; p95 uses nearest rank. Queries return at most 50 identifiers in deterministic title order. Initial DB benchmark includes driver calls and query execution, not HTTP, UI, debounce, authentication, all organization fields, or simultaneous users. The corpus tests maximum text volume but is not representative of every Unicode distribution.

| Query | Initial PostgreSQL p95 ms | Bun SQLite p95 ms | Interpretation |
| --- | --: | --: | --- |
| absent `🫠` | 1063.8 | 161.1 | Full scan |
| absent `🫠x` | 14.0 | 128.7 | PostgreSQL extracted selective word-boundary candidates; SQLite exact scan |
| common `a` | 1043.4 | 103.2 | Broad scan/materialization/sort |
| common `ab` | 1155.3 | 118.1 | Broad scan/materialization/sort |
| common `common` | 433.9 | 120.9 | Index matches nearly every row |
| absent `zzzzzz` | 117.8 | 0.8 | PostgreSQL rechecked 4,283 trigram candidates; positional FTS was selective |

See complete [baseline plans and timings](search-parity/benchmark.json) and the separate native results rather than treating these numbers as a direct engine contest. SQLite index build took 47.6 seconds; PostgreSQL GIN build 33.6 seconds. The generated SQLite file was about 559 MiB including duplicate projections/indexes; PostgreSQL reported 433 MiB total, 195 MiB indexes. This is material capacity overhead beyond the 100 MiB logical quota.

## Bounded optimization findings

An indexed PostgreSQL title/identity order plus exact per-field eligibility and `LIMIT 50` reduced p95 for `a`, `ab`, and `common` to **1.8–2.1 ms**. It still correctly scanned for absent `🫠`, at **366 ms** p95. Early LIMIT is safe only after eligibility and chosen ordering; it cannot arbitrarily truncate candidates before relevance calculation. [Measured plans](search-parity/ordered-index-results.json).

A separate in-process prototype caches normalized text and compact sort metadata, uses exact per-field unigram/bigram document bitmaps for short terms, checks longer literals with in-memory substring operations, and combines hit information before title/relevance sorting. SQL oracle checks agree for its six single-term benchmark queries; multi-term cases exercise AND/title-tier behavior but are not a full six-field production oracle.

| Prototype operation | Observed result |
| --- | --- |
| Warm short absent/common queries, title or relevance | p95 0.1–0.8 ms |
| Warm common long term / cross-field AND examples | p95 1.8–2.5 ms |
| Warm absent `zzzzzz`, scanning cached text | p95 15.8 ms |
| Load normalized 100 MiB rows from SQLite | 89 ms, one warm-OS-cache observation |
| Build short-term index from all text | 5.9 seconds; independent run 8.6 seconds |
| Bitmap payload | 1.02 MiB approximately; 1,500,478-byte serialized cache |
| Restore serialized short-term cache | p95 2.9 ms, warm OS cache |
| Process RSS | Approximately 444 MiB after GC in cache experiment; not a retained-object-size measurement |
| 256 KiB edit, index preparation alone | p95 24.3 ms |
| 256 KiB synthetic durable transaction | p95 84.2 ms |

[Memory experiment](search-parity/memory-index-results.json), [persistence experiment](search-parity/cache-results.json). The durable WAL/FULL transaction includes text, FTS delete/insert, conservative posting-page rewrites, full-variant outbox insertion and revision increment. It is an **I/O allowance**, not a correct incremental membership implementation: posting values are rewritten unchanged. It does not test production quotas, recovery, sustained WAL growth, or all 20 assigned tags. No new application save guarantee follows from it.

A promising implementation direction is therefore a **versioned persisted exact short-term index**, compact per-field hit sets for ranking, selective longer-term candidates with exact verification, and bounded worker-owned normalized-text caching where needed. Persist/reload indexes rather than rebuilding the entire library on every cold launch. Publish index changes only with the committed local revision; stale server caches must be tied to committed library revisions and invalidated after every relevant prompt/organization/use change. Server cache misses, multiple workers, eviction, and 20 active libraries need explicit treatment.

Do not adopt this prototype's dense bitmap representation unconditionally. It is efficient for the small alphabet in this corpus but allocates a full 10,000-document bitmap per distinct gram. High-cardinality Unicode can cause enormous growth. Use sparse/dense adaptive postings, measure high-entropy Unicode and organization-field multiplicity, and set a bounded cache/index policy whose fallback preserves semantics. Long queries with many terms can also multiply full-text scans; the fast six-term sample is not a worst-case bound. Shared native/WASM or carefully bounded separate implementations remain candidates, not a selected new dependency or service.

## Preliminary design questions, addressed by the final addendum

The initial scan-based path is an implementation-design blocker, not merely a generic reminder to benchmark later. The optimized direction has bounded positive evidence, but before finalizing it: select a space-bounded posting representation; demonstrate full normalization/cross-field/ranking parity in Rust and Bun; prove mutation/rename/delete/rebuild consistency; measure persisted cold startup and maximum edits; and measure cold server-cache misses, tenant isolation, memory pressure and the complete 200-code-point query space on diverse worst-case data. The implementation must still meet the accepted 4-core/8 GiB desktop and hosted workload with UI/network costs included. Changing semantics, quotas or latency targets requires a separate human decision.

## Reproduction

Research assets are isolated in `docs/research/search-parity`; nothing imports them into the application. Start a disposable PostgreSQL 17 container on loopback port 55439 with database `search_research`, user `postgres`, password `search-research-only`, or set `SEARCH_DATABASE_URL`. The scripts create/drop only `prompts` and `bench` in that disposable database. Never point them at an existing service database.

Run `bun docs/research/search-parity/harness.mjs`; set `SEARCH_BENCH=1` for the maximum-library fixture. Run `ranking.mjs`, `ordered-index.mjs`, `memory-index.mjs`, and `cache-persistence.mjs` with Bun after that fixture exists. Run `cargo run --locked --release` from `docs/research/search-parity/native`. The cached Unicode download, SQLite files, native build output and temporary bitmap cache are ignored. JSON findings and the Cargo lockfile are committed. The separate generated-data research container is removed after measurement.

## Addendum: exact positional path and proposed bounded design

The final bounded experiment replaces aggregate candidate/recheck plus full-text hydration with **per-field exact positional FTS matches**. `detail=full`, `trigram case_sensitive 1`, unchanged already-normalized field text, and correctly quoted terms of at least three code points are essential. The trigram phrase preserves consecutive positions: matching the overlapping trigrams of a literal establishes that literal's contiguous occurrence. It is therefore an exact predicate for this chosen configuration, not a similarity score. No large-text recheck is required for this path. One/two-code-point terms use exact persisted postings. Both paths produce the same field-hit sets, which supply eligibility and the six product tiers.

The [additional harness and results](search-parity/field-fts-results.json) passed **1,632 per-field comparisons** against literal substring predicates, including 200 generated adversarial Unicode/punctuation terms, a 200-code-point literal, and a 199-code-point conjunction containing 50 distinct terms. This is a finite conformance corpus, not an exhaustive Unicode proof or a complete release workload. The Rust checker also performs per-field FTS comparisons against Rust `str::contains`; its exact count is recorded in the updated native results. Raw query length validation precedes normalization, so expanded normalized values must not be silently truncated.

On the 10,000-row/100 MiB corpus, metadata plus persisted short postings loaded in **24.6 ms** from a warm OS cache, without loading content. Warm p95 query execution was **0.2–8.4 ms** for short terms, **15.3 ms** for common long terms, **19.9 ms** for a cross-field AND example, **2.8 ms** for the rare long term, and **3.8 ms** for a 50-term absent conjunction. Both title and relevance sorting were exercised over title/content hits. The earlier six-field fixture covers tier semantics; this capacity benchmark has only title/content populated. These results leave plausible room within 150 ms; they do not establish that debounce, HTTP/network, cold I/O and UI presentation fit the remainder on supported machines.

### Proposed selection, pending the human's architecture choice

Use the same versioned derived SQLite search schema in **Bun server workers** and the **Rust desktop storage owner**. PostgreSQL remains the server's sole canonical store for accounts, prompts, organization, operation receipts and synchronization. Server SQLite is a rebuildable index, not a second authority. Bun supplies its own SQLite driver; its synchronous API belongs in a worker, not the request event loop. [Bun SQLite](https://bun.com/docs/runtime/sqlite).

The server's durable PostgreSQL change log is the source of index catch-up. Persist a per-library applied revision in the same SQLite transaction as index changes. A search must bind to an authorized instance/account and a known committed library revision. If the index is behind, catch it up before claiming that revision; return an explicit retry/loading state if catch-up fails, never silently claim stale data are current. Serialize each index writer. Desktop text, postings, positional index, revision and outbox changes remain one local transaction. Organization renames, assignment changes and deletion update their affected search state; usage/sort changes update metadata without rewriting content. Rebuild from canonical data into a staged index, then atomically switch when complete. Keep old normalization/index versions until migration succeeds.

Define short postings by `(library, field class, normalized one-or-two-code-point gram)` and stable local prompt slots `0..9999`, with an identity-to-slot map. Tag values can share one tag field class separated by whitespace; collection remains a separate class. For every posting with `d` document slots and `r` consecutive runs, select the smallest of:

- Sorted little-endian unsigned 16-bit slot array: `2d` payload bytes.
- Fixed 10,000-bit bitmap: **1,250 payload bytes**.
- Sorted `(start, length)` unsigned 16-bit runs: `4r` payload bytes.

Persist an explicit representation tag, counts and normalization/schema version. Slots are not prompt identities; delete all corresponding postings before reusing a slot, or reuse only on a transactional rebuild. The payload bound is `min(2d,1250,4r)` per key; it excludes key/B-tree/page overhead. For `N` normalized indexed code points across all field values, unique gram-document memberships are at most `2N`, so array-form posting payload alone is at most `4N` bytes. Dictionary keys, metadata, positional indexes, field replication and database overhead are additional. This is a concrete payload bound, **not** a claim that total index size is four times raw text.

Keep this dictionary on disk; fetch only query keys and merge term hits incrementally. Do not allocate a dense bitmap for every vocabulary gram or load the whole library text. A 200-code-point whitespace-separated raw query contains at most 100 nonempty terms; for five field classes, at most 500 short-posting values are needed, at most **625,000 payload bytes** before reuse/streaming. At most 10,000 live identities and their compact sort metadata are needed per active library. For long terms, iterate field-hit IDs into compact bitsets rather than retaining every term's full object array. The 50-term test is a syntax/parity and bounded execution observation, not proof of the worst-case all-common distribution.

Proposed cache budgets are **256 MiB total for desktop search workers** and **512 MiB total for server search workers**, covering SQLite page caches, decoded postings and sort metadata; keep authoritative prompt/outbox storage outside eviction. Budget these globally across open connections and tenants, not independently per connection. Evict derived pages/decoded postings and read their on-disk representations on demand, preserving exact semantics. Do not use the earlier 444 MiB full-text-cache prototype. A cache cap bounds resident application allocations, not file size or OS-wide page cache. Actual allocator/runtime overhead and concurrent worker counts must be included in implementation measurements.

Cold startup opens the persisted index and loads only metadata/version information; it does not rebuild from 100 MiB text. The measured warm-cache 24.6 ms metadata reload is promising but is not a cold-disk or packaged-launch result. A missing/incompatible index needs the explicit staged initialization/rebuild path, with progress and the existing initial-index budget. Normal startup must preserve and reuse a compatible index. Save correctness and the 200 ms save target must be checked against real posting mutations, not inferred from the synthetic 84 ms transaction allowance.

### Disk tradeoff requiring explicit acceptance

The per-field positional index measured **533,254,144 bytes after optimization**, about **508.6 MiB**, for 100 MiB raw title/content. Optimization took 6.2 seconds and changed size only slightly; initial build took 66.5 seconds. [Exact measurements](search-parity/field-fts-optimize-results.json). Linear extrapolation of this one noisy corpus gives **about 50.9 GiB of positional index for 10 GiB of text**, before canonical PostgreSQL data, normalized projection text, short postings, WAL, backups and operational space. This directly rules out claiming the measured complete workload fits a 40 GiB disk.

A provisional **128 GiB** starting disk is a reasonable architecture proposal to discuss alongside this index choice, retaining expansion alerts at 70% and intervention before 80%. It is not a proven upper bound for arbitrary Unicode, repeated organization fields, all 1,000 maximum-size libraries, or pathological short-posting dictionaries. Deployment must measure actual physical growth, preserve reserve for rebuild/WAL, and expand according to the already accepted operating policy. The user must accept this changed provisional baseline; actual host allocation remains the deployment decision.

This positional/posting design is now a specific candidate with semantic and bounded performance evidence. The alternative is to retain PostgreSQL-only search and undertake further exact short-term/positional indexing work; the initial pg_trgm scan path does not meet the observed budget. Once the candidate and resource tradeoff are accepted, remaining work is implementation and the specified release tests: shared normalization conformance, real incremental membership/deletion updates, crash/rebuild/rename consistency, cold startup, true disk and RAM pressure, full fields/ranking/filters, maximum multi-term queries, and the agreed concurrent-host/UI workloads. No semantics or latency target is relaxed by this recommendation.

The final addendum supersedes the preliminary design questions above: after the human accepts the shared derived SQLite candidate, adaptive representation, revision fencing, cache budgets and revised provisional disk, this research can resolve as **feasible candidate selection**. No additional open-ended research ticket is required merely because production integration and supported-hardware release tests have not been performed. Conversely, this report does not make that human choice or certify those tests. The two decisions awaiting acceptance are the added server-side derived SQLite index and the provisional disk change; the proposed technical details make them concrete and reviewable.

Run the addendum's field-fts.mjs after cache-persistence.mjs creates the ignored bitmap cache; run optimize.mjs afterward, then rerun the native checker for its per-field checks. The final recorded native run passed 522 distinct per-field cases in addition to the 39 end-to-end query cases.

## Final compact-index comparison: supersedes the positional/128 GiB proposal

A follow-up requested a smaller design rather than assuming the full positional index was necessary. **Recommend compact per-field trigram indexes with exact verification and ordered, bounded body fetches. Keep the same search semantics and 150 ms end-to-end target. Recommend 64 GiB as the provisional disk for validating the 10 GiB aggregate workload; do not require 128 GiB.** A smaller initial deployment can start with 40 GiB and expand under the existing operating policy. Actual allocation remains the deployment decision.

### Selected query mechanics

Use one external-content FTS5 table per field class with `trigram case_sensitive 1`, `detail=none`, and `columnsize=0`. The normalized source values remain authoritative for matching; separate field tables preserve field membership despite omitted column positions. For terms longer than three code points, generate their unique overlapping three-code-point grams, quote each gram by doubling embedded quotes, AND those grams, and then verify literal substring occurrence. Nonpositional gram conjunctions can have false positives and must never replace that last check. A three-code-point term is itself one exact per-field trigram; one/two-code-point terms use the already specified exact adaptive postings.

SQLite documents that `detail=none` omits positions and column filters, and that reduced-detail trigram MATCH cannot directly query a token longer than three code points. This design asks MATCH only for individual trigrams. An escaped literal GLOB path also passed the fixtures, but it is **not the selected query method**: explicit gram candidates plus exact substring verification make the boundary and shared Rust/Bun behavior clearer. [SQLite reduced-detail restrictions](https://www.sqlite.org/fts5.html#the_detail_option).

Compute eligibility candidates using AND across terms and OR across fields. For explicit sorts, walk candidates in the complete accepted sort order and verify eligibility before accepting each row. For relevance, either establish the exact tier first or use an optimistic best-possible tier from per-field candidates, plus the complete deterministic tie tuple. Maintain the best verified page. Stop only when the best possible key of every unexamined candidate cannot outrank the last verified result. A failed positional verification can move a candidate to a worse tier or exclude it; it cannot justify discarding unseen candidates. Never take an arbitrary candidate limit before ranking.

Read normalized values in ordered batches of at most **64 candidates or 4 MiB**, using persisted value-byte metadata to enforce the byte bound. Read a candidate body once, evaluate all remaining terms against that value, and discard it after the batch; do not create a full-library text cache. Evaluate exact short/three-code-point field hits and cached title metadata first. Preserve the existing 256 MiB desktop / 512 MiB aggregate server search-cache budgets, versioned normalization, adaptive postings, and PostgreSQL-revision fencing from the addendum. Only the positional-index representation and provisional disk recommendation change.

The two-field capacity prototype can establish exact tiers from title metadata because all remaining matches are content-only. The full implementation must cover organization and description tiers, filters, dates/null handling, and their optimistic-bound ordering proof. This is a specified correctness requirement, not a claim those extensions were implemented. Early stopping is valid only with that proof; scanning all remaining candidates is always a correct fallback and remains subject to performance gates.

### Measured storage

Both datasets contain exactly 10,000 prompts and 100 MiB of title/content. The first is the previous deterministic noisy-letter corpus. The second is explicitly **synthetic prose-like text**, built from seven instruction-sentence templates plus varying reference/section numbers, repeated to the same sizes. It is not actual user data and must not be described as a representative prompt distribution. Both are already normalized; Unicode normalization expansion and organization-field replication are not included.

| Component | Noisy corpus | Synthetic prose-like corpus |
| --- | --: | --: |
| Compact FTS index only, used pages | 77.05 MiB | 4.19 MiB |
| Normalized source table/schema, used pages | 117.28 MiB | 117.28 MiB |
| Derived database total, used pages | 194.33 MiB | 121.47 MiB |
| Actual file after build/optimization, including free pages | 209,022,976 bytes | 131,526,656 bytes |
| Exact short-posting bitmap payload, separately measured | 1.02 MiB | 0.56 MiB |
| Compact index build and optimization | 18.7 seconds | 1.7 seconds |

The previous optimized full positional index alone occupied **508.6 MiB** on the noisy corpus. Compact indexing reduces that component by about **85%**, while retaining exact eligibility through verification. Short-posting payload numbers exclude their dictionary/persistence overhead. Used-page totals exclude WAL, backups and rebuild scratch space. [Compact measurements](search-parity/compact-results.json).

Scaling only the noisy fixture linearly, 10 GiB of logical text implies about **19.4 GiB of used derived SQLite pages**, or about **19.9 GiB including this build's free pages**, plus short postings and metadata. Add roughly 10 GiB of canonical PostgreSQL text as a conceptual starting allowance, then its row/index/TOAST overhead, WAL, operations/change history, normalization inflation, organization projections, backups and rebuild reserve. Canonical physical size was not remeasured in this comparison. The synthetic prose derivative scales to approximately 12.1 GiB before those additions; actual PostgreSQL compression may differ radically and is not assumed.

These are workload extrapolations, not capacity guarantees. At 40 GiB, the existing 70% alert and 80% expansion thresholds are 28/32 GiB, leaving little room beyond the noisy fixture's canonical-plus-derived starting allowance. At 64 GiB they are 44.8/51.2 GiB, making **64 GiB a defensible provisional validation allocation with useful headroom**. Rebuild one bounded library at a time rather than duplicating every index simultaneously. Measure actual high-cardinality Unicode, field multiplicity, persistent operation growth and WAL/rebuild peaks, and expand before the existing threshold. No promise is made that every permitted distribution fits 64 GiB or that all 1,000 accounts reserve their maximum quota.

### Measured query outcomes

The comparison retained the original machine/runtime and 20 samples after one warmup, with a **64 MiB SQLite page-cache setting**. OS caches were warm/uncontrolled. Timing includes candidate generation, exact checks, ranking, and identifier selection, but excludes HTTP/network, UI/debounce, authentication and production concurrency. Full text retained by the independent oracle is outside the tested query algorithm; no process-RSS claim follows from this harness.

Simple per-term full scans were rejected: the synthetic prose two-term query took 126 ms p95 before network/UI. A fused all-candidate SQL check was also insufficient for broad complex queries: its 197-code-point query took 261 ms p95. Ordered exact verification and bounded batching avoid repeatedly scanning every qualifying body.

| Relevance query                | Final noisy p95 | Final synthetic prose p95 |
| ------------------------------ | --------------: | ------------------------: |
| absent one-code-point `🫠`     |         0.64 ms |                   0.13 ms |
| common one-code-point `a`      |         1.84 ms |                   0.96 ms |
| common long term `common`      |         4.90 ms |                   4.03 ms |
| cross-field `prompt common`    |         8.95 ms |                  10.04 ms |
| absent `zzzzzz`                |        53.18 ms |                   0.38 ms |
| 197-code-point / 25-term query |        16.12 ms |                  77.09 ms |

The noisy `zzzzzz` query produced **4,283 false-positive candidates** and verified all of them to return no rows; none was dropped through a candidate cap. The common and cross-field queries verified 50 eligible rows in a provably complete order before stopping. The long prose query had 10,000 coarse candidates, all 25 terms common, and verified 50 results. Title sort was measured as well; raw per-case outputs include both sorts. [Ordered/batched final timings](search-parity/compact-batched-results.json), [fused and point-read comparisons](search-parity/compact-ordered-results.json).

Correctness evidence: **1,368 compact per-field assertions** comparing both candidate-plus-instr and literal GLOB with an independent substring oracle, including punctuation, supplementary Unicode, long terms and a deliberate `abcXXbcd` false positive for `abcd`. All benchmark title/relevance outputs were checked against full-text oracle results. The pinned Rust build passed **60 compact predicate cases**, including that false-positive rejection; it still consumes normalized fixtures rather than implementing production normalization. [Native compact results](search-parity/compact-native-results.json).

The final candidate gives meaningful room for the end-to-end budget in measured common cases and materially reduces disk requirements. The 77 ms complex-query and 53 ms false-positive cases leave less room, especially after the agreed 50 ms network condition and on slower hardware. Do not certify 150 ms from these measurements. Retain the unchanged supported-hardware, cold-start, full-field/ranking/filter, concurrency, mutation/crash, high-cardinality and worst-case multi-term release gates. A distribution containing many nonpositional false positives can still require inspecting the full eligible library. Batched verification preserves correctness under that workload; its cost must be measured rather than concealed by truncation or weaker matching.

### Reproduction and scope

After the earlier fixture exists, run `bun docs/research/search-parity/compact.mjs`. Run `compact-ordered.mjs` normally for fused/point-read comparisons and with `COMPACT_BATCH=1` for the final batched path. Run `cargo run --locked --release -- --compact` from the native harness directory. All databases are generated research files; no production schema or dependency changed. This section supersedes the earlier recommendation of full positional indexing and a 128 GiB provisional disk. It completes a bounded candidate comparison; production implementation and release testing remain subsequent work.
