# Proposed startup validation change for #65 / PR #119

Status: **explicitly approved by the user; implemented, with final capacity validation in progress**. Automatic approval review initially blocked the production redesign. The user then approved this concrete plan, including background snapshots, exact fallback and revision-matched trust.

## Evidence and decision

The focused public native command loop takes 9.8 and 9.4 seconds before any WebView or query work. On a disposable copy, the app's bundled SQLite takes 9.1 seconds for full FTS external-content validation and 0.9 seconds for index-only validation. Bounded memory mapping, temporary-storage changes and the Windows heap allocator did not materially improve the full check. Disabling allocation statistics reduced the probe to 7.3 seconds, still above the complete startup budget. No allocator/configuration change is proposed for production.

[SQLite documents that rank=0 omits external-content comparison](https://www.sqlite.org/fts5.html#the_integrity_check_command). The added public-command regression removes a prompt's content postings while leaving a structurally valid index: rank=0 succeeds, rank=1 detects the mismatch, and reopening must recover the complete search result and pending edit. Dropping full validation would miss this case.

## Proposed implementation

Keep this behavior inside native search storage; keep public REST and typed native contracts unchanged.

1. Opening a compatible library runs bounded table, version and short-posting checks, and verifies that all four index tables can be opened. Full index structure and external-content checks both run on the snapshot. Existing preparation/recovery remains available for incompatible or unreadable state.
2. A background validation job opens the source read-only and takes a consistent SQLite backup into a private, unnamed temporary database. Preflight the temporary volume using measured page count/size, including committed WAL pages. Bound both connection caches and backup steps; enforce a deadline.
3. Until validation succeeds, queries perform exact normalized-source scans. Read each body once for all terms, retain bounded rows/bytes and cancellation, and preserve all five fields, filters, sort tiers, selection and pagination. Never derive candidate exclusions from unverified postings.
4. Enable indexed candidates only if the successfully validated snapshot's projection revision and the starting main connection's PRAGMA data_version both still match the active library. The latter detects commits by other connections without comparing data_version values across connections. Discard stale results. Incremental writes after a trusted baseline retain their existing atomic index/projection/outbox transaction.
5. A matching-revision corruption result invokes the existing preserving recovery path. Scratch/I/O failure never makes unchecked postings trusted. Continue exact matching where possible and retain explicit recovery errors where it is unavailable.
6. Account transition, store closure and shutdown cancel and join the job. Interrupt both SQLite connections. Verify temporary-database removal on normal closure and forced process termination; do not leave named copies of account data.

SQLite's [unnamed temporary databases](https://www.sqlite.org/inmemorydb.html#temporary_databases) are private to their connection and removed on close. Force file-backed temporary storage with bounded caches rather than a full in-memory library copy. Windows crash cleanup must still be verified in the implementation.

## Required validation before pushing a production fix

- The existing focused startup command must become green without changing its three-second assertion. This host remains supporting evidence; installed UI startup on the required machine remains a separate gate.
- Pause validation deterministically and prove complete Unicode/five-field results, relevance tiers, filters, pagination, cancellation and selected identity through public native commands.
- Prove missing and malformed postings recover without losing canonical text or pending operations.
- Edit text, rename organization entries and record prompt uses during validation; reject stale results and preserve acknowledged writes.
- Test sign-out/account switches and forced termination while a backup or integrity check is running. Verify cleanup and absence of cross-account publication.
- Test insufficient scratch and I/O failures, bound active caches, then rerun native regressions and affected UI/capacity measurements.

## Risks to review

This adds native concurrency and temporary disk I/O. The main correctness risks are trusting a stale snapshot, allowing unverified postings to hide matches, blocking durable saves during copying, and retaining account data after closure. The user explicitly approved this design before implementation. The proposal does not relax integrity checking or change the release budgets.
