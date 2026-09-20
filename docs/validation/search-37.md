# Issue #37: five-field retrieval and combined views

The web library now searches title, content, description, tag names and collection names with cross-field AND matching and all six relevance tiers. The shared normalization fixtures also exercise tag and collection names through authenticated REST. Favorites never receive a ranking boost; repetition adds no score. Existing deterministic sorts and complete revision-bound paging remain in use.

## Behavior and storage

- All, Favorites, Archive and collection views combine with an independent collection filter, every selected tag, an optional favorite condition and literal search. Archive remains isolated. Collection views use `view=collection` with `viewCollectionId`; the optional `collectionId` remains an independent condition. Validators, the validated client, OpenAPI and signed cursor binding were updated together.
- Collection navigation clears the query and extra filters. Optional filters retain the query. Clear search and Clear extra filters are separate actions; clearing extras retains the inherent view. Browsing sort is remembered per account, instance and view identity, and clearing a search restores it. Selection checks all five fields and follows eligible prompt identity.
- Complete searchable pickers retain library-wide active/archive counts and bounded scroll regions at 200 collections and 1,000 tags. Deleted and merged conditions retain their identities and explicit recovery controls. Creating an equal name cannot replace a selected deleted identity.
- Organization names have an independent 1,200-slot SQLite projection, external-content compact trigram FTS, adaptive exact short-term postings and membership expansion. Name-only changes update that projection without fetching or rewriting prompt bodies. REST timing assertions confirm zero prompt updates and zero body bytes for a tag rename, while saved prompt modification dates remain unchanged.
- Projection checkpoints include account, instance, recovery epoch, normalization/index version and library revision. Cursor signatures include the complete filter scope. Query caches include epoch/normalization and discard inactive result sets. Two server workers, 64 MiB SQLite caches per worker and 64-row/4 MiB body batches remain bounded. Only qualifying page summaries are fetched; tag arrays are read only when tag filters require them.
- Recents and copy/usage integration remain the explicitly separate approved slice. No native commands or native permissions changed in this web slice.

## Verification

The production Bun/Next.js harness uses an isolated PostgreSQL/SMTP Docker project and Chrome. New tests cover the canonical six-tier fixture with two-result pages, Unicode/literal name matching, combined filters, archive isolation, rename/delete identity, cursor consistency, strict request validation, navigation/sort memory, complete pickers and unavailable collection views. Existing search and organization regression tests also run against the production build.

Commands:

```powershell
bun run typecheck
bun run test
bun run --cwd apps/web test:search apps/web/tests/full-search-integration.test.ts apps/web/tests/full-search-browser.test.ts apps/web/tests/full-search-capacity.test.ts
```

The new suites passed 26 tests. A broader run passed 54 search/organization tests before the final metadata-read optimization. Final sort, selection, collection and tag regressions passed 36 cases and exposed one test race: Escape was sent while a tag rename was still refreshing. The test now waits for save acknowledgement and dialog closure; all six tag-management/new-navigation tests then passed. The workspace suite passed 98 tests; final typechecking and changed-source Ultracite checks passed. The default search runner includes the new all-field suites and capacity workload.

After the review's shared trigram extraction, all 47 REST conformance tests passed again. Standards review: no outstanding findings. Specification review: no actionable findings. The latency limitation below remains an explicit release gate.

React Doctor 0.9.14 was invoked with Bun and `--verbose --scope changed`, but its standalone CLI failed on Windows with `child.channel?.unref is not a function`; no score is claimed. The repository's configured React Doctor lint plugin runs as part of Ultracite.

## Actual maximum-capacity measurements

[Raw samples and host details](../research/web-full-search-measurements.json) contain the actual measurements, including individual Server-Timing values. The synthetic corpus has exactly 100 MiB of canonical text, 10,000 prompts, 1,000 tags, 200 collections and 20 tag memberships per prompt. All five searchable fields are populated. These are local loopback production-build measurements on the recorded Windows host, not supported-hardware or concurrent-tenant release certification.

| Query | Warm REST range | Input through render |
| --- | --: | --: |
| `a` | 112.8–122.7 ms | Not sampled |
| `C++` | 67.7–76.1 ms | Not sampled |
| `common` | 74.4–86.1 ms | Not sampled |
| `prompt description common tag collection` | 132.7–150.7 ms | 250.5 ms |
| `tag` | 118.8–132.5 ms | 229.6 ms |
| `collection` | 77.3–86.3 ms | 180.8 ms |
| `abcd` (all body candidates fail exact verification) | 261.4–278.1 ms | 348.9 ms |
| 197-code-point multi-term query | 118.4–137.7 ms | Not sampled |

REST ranges contain ten samples after one warm-up. Browser observations include the 35 ms debounce, DOM commitment and two animation frames. Cold preparation took 56.8 seconds including retry polling; the projection occupied 161.8 MiB. The adversarial query verifies every candidate without an arbitrary cutoff.

The required measurements expose an unmet **150 ms end-to-end release gate**, including common full-field searches. This slice does not certify that gate or weaken it. Further performance work and the supported-machine/concurrent-server release workload remain required before release.
