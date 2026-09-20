# Desktop library download — issue #40

Validated on Windows on 2026-09-20 with Bun 1.4.2, Rust/Tauri, PostgreSQL 17 and Chrome. This evidence covers the initial read-only library download slice. Incremental synchronization, editing/outbox reconciliation, and full replacement of an established library remain separate tickets.

## Contract and implementation

- Device-only REST: `POST /api/v1/sync/snapshots` and `POST /api/v1/sync/snapshots/page`. A manifest is account/instance/epoch-bound, includes its revision cut, 15-minute expiry, expected prompt count and each page's byte length/SHA-256 digest. The digest covers the exact UTF-8 bytes of the decoded payload string. The entire serialized page response is limited to 4 MiB.
- PostgreSQL migration 017 materializes one reusable snapshot per account. Account/session/library locks serialize the cut with mutation and deletion. Eight-row keyset batches bound source reads. All pages commit before the manifest is returned; no transaction spans page requests. Expired manifests are inaccessible and replaced on the next manifest request; account deletion cascades through snapshot data.
- One native connection per active partition is serialized by the native service. SQLite schema 1 verifies WAL, FULL synchronization and foreign keys, and uses a 250 ms busy timeout. The UUID-based partition path is native-owned. Credentials and tokens never enter renderer responses.
- Native `library_status`, `library_download`, `library_browse`, and `library_detail` commands expose committed progress, bounded 50-row browsing and complete text. Each page and its progress commit together. Failed/expired downloads preserve the prior usable generation; a restarted initial download stages separately until complete. Unknown newer schemas fail safely. Completed initial snapshots are reported at their revision, without claiming current synchronization.
- Sign-out understands only this read-only schema and removes only its exact partition files after invalidating in-flight responses. Unknown files/newer schemas retain the previous review safeguard. There is no edit/discard bypass for a future outbox.

## Executed checks

- `bun run test`: all seven workspace tasks passed.
- `bun run typecheck`: all six workspace checks passed.
- `bun x --bun ultracite check`: formatting and lint passed, including the repository's React Doctor rules.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: 21 passed, including real Windows Credential Manager and a separate-process restart. Snapshot tests cover partial progress, restart, disconnect, expiry/restart, digest failure, a real read-only filesystem failure, wrong-account manifests, missing credentials and exact sign-out cleanup.
- `bun --env-file=apps/web/tests/device.env apps/web/tests/snapshots-runner.ts`: real REST ownership/bounds/revision-cut tests, expiry across a server restart with a test-only clock, and Rust HTTPS → browser email approval → Windows Credential Manager → partial download → native process restart → complete download → server disconnect → new process offline detail → independent sign-out.
- `bun test apps/web/tests/snapshot-ui.test.ts --timeout 30000` with desktop Vite on port 1420: partial/offline messaging, committed progress, keyboard detail opening and exact whitespace passed. This UI check substitutes the typed native boundary; persistence is tested by the real native journey above. Screenshot: `.scratch/issue40-partial-offline.png`.

## Measured initial-download costs

Synthetic fixture: 10,000 prompts, exactly 104,857,600 logical UTF-8 text bytes (repeated ASCII content). The real HTTPS/native journey produced 27 pages. Its latest measured elapsed time was 15,403 ms, including process restart and a final disconnected process opening a downloaded prompt. An earlier run measured 17,844 ms. Both were below the specified 120-second initial-download budget on this development machine.

After the offline restart, the library SQLite file occupied 123,936,768 bytes (118.20 MiB), shared-memory file 32,768 bytes, WAL 0 bytes and session metadata 8,192 bytes. During download/staging, additional WAL and scratch space are required. This is not a worst-case arbitrary-Unicode or supported-hardware benchmark; JSON escaping, metadata and replacement staging change costs. No artificial response truncation or durability reduction was used.

## Limits of this evidence

An actual Windows reboot/logon, second-Windows-user ACL audit and a release-signed installer were not exercised in this slice. Separate native processes and real credential persistence were exercised. The standalone React Doctor 0.9.14 CLI failed under the required Bun runtime with `child.channel?.unref is not a function`, so it produced no regression score; the integrated lint rules passed. No Node fallback was introduced.
