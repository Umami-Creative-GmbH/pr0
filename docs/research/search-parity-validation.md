# Literal substring search parity and bounded performance

Research for [Validate literal substring search across PostgreSQL and SQLite](https://github.com/Umami-Creative-GmbH/pr0/issues/15), investigated 2026-09-19. This records isolated experiments, not a production engine or a release-performance certification. The accepted [search behavior](https://github.com/Umami-Creative-GmbH/pr0/issues/7#issuecomment-5742642457), [capacity envelope](https://github.com/Umami-Creative-GmbH/pr0/issues/8#issuecomment-5742705995), and [storage foundation](https://github.com/Umami-Creative-GmbH/pr0/issues/10#issuecomment-5742823054) remain authoritative.

## Finding

Literal matching is feasible without changing punctuation, short-query, cross-field AND, or deterministic ordering rules. **Trigram indexes alone are not a sufficient performance design.** The first maximum-library query path missed the 150 ms budget before UI/debounce/network costs. An additional experiment found a promising route through exact short-term postings, cached normalized fields, compact metadata, and appropriate ordering indexes. That route still requires bounded-memory, startup, invalidation, full-ranking, and concurrency design before becoming a final implementation plan.

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

The harness pins Bun 1.4.2's reported Unicode 17.0 / ICU 78.3 and fetches Unicode 17.0.0 CaseFolding data (SHA-256 recorded). Production needs a single shared implementation or generated version-pinned Rust/TypeScript tables plus Unicode conformance fixtures; relying on whichever ICU a browser ships is insufficient. Persist the normalization version with derived indexes. A version change requires rebuilding derived state before serving the new contract and must preserve authoritative text/outbox data. [Unicode normalization](https://www.unicode.org/reports/tr15/), [CaseFolding 17.0.0](https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt), [Unicode property data](https://www.unicode.org/Public/17.0.0/ucd/PropList.txt), [SQLite collations](https://www.sqlite.org/datatype3.html#collation).

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
| Bitmap payload | 1.07 MiB approximately; 1,500,478-byte serialized cache |
| Restore serialized short-term cache | p95 2.9 ms, warm OS cache |
| Process RSS | Approximately 465 MiB after GC in cache experiment; not a retained-object-size measurement |
| 256 KiB edit, index preparation alone | p95 24.3 ms |
| 256 KiB synthetic durable transaction | p95 84.2 ms |

[Memory experiment](search-parity/memory-index-results.json), [persistence experiment](search-parity/cache-results.json). The durable WAL/FULL transaction includes text, FTS delete/insert, conservative posting-page rewrites, full-variant outbox insertion and revision increment. It is an **I/O allowance**, not a correct incremental membership implementation: posting values are rewritten unchanged. It does not test production quotas, recovery, sustained WAL growth, or all 20 assigned tags. No new application save guarantee follows from it.

A promising implementation direction is therefore a **versioned persisted exact short-term index**, compact per-field hit sets for ranking, selective longer-term candidates with exact verification, and bounded worker-owned normalized-text caching where needed. Persist/reload indexes rather than rebuilding the entire library on every cold launch. Publish index changes only with the committed local revision; stale server caches must be tied to committed library revisions and invalidated after every relevant prompt/organization/use change. Server cache misses, multiple workers, eviction, and 20 active libraries need explicit treatment.

Do not adopt this prototype's dense bitmap representation unconditionally. It is efficient for the small alphabet in this corpus but allocates a full 10,000-document bitmap per distinct gram. High-cardinality Unicode can cause enormous growth. Use sparse/dense adaptive postings, measure high-entropy Unicode and organization-field multiplicity, and set a bounded cache/index policy whose fallback preserves semantics. Long queries with many terms can also multiply full-text scans; the fast six-term sample is not a worst-case bound. Shared native/WASM or carefully bounded separate implementations remain candidates, not a selected new dependency or service.

## Remaining design and release gates

The initial scan-based path is an implementation-design blocker, not merely a generic reminder to benchmark later. The optimized direction has bounded positive evidence, but before finalizing it: select a space-bounded posting representation; demonstrate full normalization/cross-field/ranking parity in Rust and Bun; prove mutation/rename/delete/rebuild consistency; measure persisted cold startup and maximum edits; and measure cold server-cache misses, tenant isolation, memory pressure and the complete 200-code-point query space on diverse worst-case data. The implementation must still meet the accepted 4-core/8 GiB desktop and hosted workload with UI/network costs included. Changing semantics, quotas or latency targets requires a separate human decision.

## Reproduction

Research assets are isolated in `docs/research/search-parity`; nothing imports them into the application. Start a disposable PostgreSQL 17 container on loopback port 55439 with database `search_research`, user `postgres`, password `search-research-only`, or set `SEARCH_DATABASE_URL`. The scripts create/drop only `prompts` and `bench` in that disposable database. Never point them at an existing service database.

Run `bun docs/research/search-parity/harness.mjs`; set `SEARCH_BENCH=1` for the maximum-library fixture. Run `ranking.mjs`, `ordered-index.mjs`, `memory-index.mjs`, and `cache-persistence.mjs` with Bun after that fixture exists. Run `cargo run --locked --release` from `docs/research/search-parity/native`. The cached Unicode download, SQLite files, native build output and temporary bitmap cache are ignored. JSON findings and the Cargo lockfile are committed. The separate generated-data research container is removed after measurement.
