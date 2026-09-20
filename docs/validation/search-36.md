# Issue #36: literal web text search

Implemented title, description and content search through the authenticated REST boundary and the production web library. Collection/tag name evidence and the expanded view/filter slice remain separate work.

## Behavior and persistence

- Shared `pr0-search-v1-ucd17` normalization preserves stored text, applies literal substring matching and requires every whitespace-separated term across the three text fields. Input rejects malformed scalar text, NUL and more than 200 code points.
- Relevance and five explicit sorts have deterministic scalar-title/UUID tie breaks. Summaries default to 50 rows, cap at 100, and retain identity-based full-text reads. Signed cursors bind the query, sort, filters, account, instance, epoch, normalization version and complete library revision.
- Each account has a disposable SQLite projection of authoritative PostgreSQL data. Compact per-field trigram FTS candidates and adaptive one/two-code-point postings precede exact verification. Ordered evaluation has no arbitrary hit cap; body verification batches at most 64 candidates and 4 MiB. Metadata-only changes do not retrieve or normalize unchanged bodies.
- Two worker lanes bound concurrent indexing/search work. A request that cannot serve a complete admitted revision returns `search_preparing` with retry guidance. Cold builds continue in the worker, and the UI retries while showing preparation. Projection contents and checkpoints commit together; incompatible, missing or corrupt indexes rebuild into a staged file.
- Typeahead includes validation, no-match feedback, remembered browsing sort, retained search sort and selection by identity. Invalid input retains selection for correction. Changed-revision paging restarts visibly, and newer result revisions refresh selected full text.

## Verification

Run from the repository root with Bun 1.4.2 and the isolated Docker acceptance services:

```powershell
bun run typecheck
bun run test
bun --env-file=apps/web/tests/social.env apps/web/tests/search-runner.ts
```

The search runner builds the production web application, then passed 27 REST/browser/capacity tests and four separately invoked recovery tests. Coverage includes shared Unicode fixtures, punctuation, supplementary scalars, malformed queries, all ordering modes, cancellation, false-positive candidates, later pages, changed revisions, deletion, identity selection and sort preservation after invalid input. Recovery verifies committed text and identical mutation receipts during index failure, durable catch-up, a compatible restart indexing zero rows, and corrupted-index rebuild.

The workspace suite passed 98 tests. Changed TypeScript/JSON/Markdown files passed Ultracite. Repository-wide lint still reports pre-existing issues in unrelated research scripts/files.

The existing prompt creation, editing, lifecycle, collection, tag and organization cleanup REST/browser suites passed all 90 tests across 12 files through the same production harness. Their read fixtures now wait through the documented preparation response; paging checks expect the specified automatic restart.

## Maximum-size measurements

Actual raw samples and host details: [search measurements](../research/web-text-search-measurements.json). Fault/restart evidence: [recovery results](search-36-recovery.json).

Measured on 2026-09-20 using a local Windows production build, Chrome, Bun 1.4.2 and an AMD Ryzen AI Max+ Pro 395. The synthetic corpus contains 10,000 prompts and exactly 100 MiB of canonical text. Each REST query discards one warm-up and records ten subsequent responses, including response-body parsing. Browser measurements include the 35 ms debounce, result DOM commitment and two animation frames; these are individual observations, not percentiles.

| Query | Warm REST range | Input through render |
| --- | --: | --: |
| `a` | 49.6–63.4 ms | 116.0 ms |
| `C++` | 48.7–54.7 ms | 123.9 ms |
| `common` | 49.5–55.7 ms | 110.9 ms |
| `abcd` (all candidates fail exact verification) | 217.2–226.9 ms | 264.8 ms |
| `prompt common` | 49.7–60.6 ms | Not measured |
| 197-code-point multi-term query | 96.8–118.0 ms | Not measured |

Cold preparation took 42.6 seconds, including retry polling; the persisted projection occupied 123.4 MiB. Queries exposed indexing, exact verification and candidate-byte counters through `Server-Timing`. The adversarial `abcd` fixture contains its individual trigrams in every body, requiring verification of all 10,000 candidates; it does not use a separate fallback scan or truncate candidates.

These text-only, loopback measurements do not certify the final all-field 150 ms release gate. The adversarial case exceeds that target. Final supported-hardware, all-field measurements and any further optimization remain required by the broader release specification.

## Operation

`PR0_SEARCH_DIRECTORY` configures derived index storage. Local development defaults to `apps/web/.data/search`; Compose mounts a dedicated search volume at `/var/lib/pr0-search`. PostgreSQL remains the backup/recovery authority. The search directory is excluded from source control and Docker build contexts. Rebuilds preflight free space for staged index/journal work and report preparation rather than serving stale results when storage is unavailable.

## Review

Standards review: no remaining findings after correcting documentation terminology and moving recovery assertions inside test blocks.

Specification review: no remaining findings after fixing selection and sort retention for invalid input. The maximum-size performance limitation above remains explicitly recorded.
