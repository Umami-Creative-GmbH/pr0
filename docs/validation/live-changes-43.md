# Live changes — issue #43

Validated on Windows on 2026-09-21 with Bun 1.4.2, PostgreSQL 17, Edge, and Rust/Tauri. Issue #43 implements incremental catch-up after the initial snapshot and offline upload slices. Expired or incompatible checkpoints return the explicit recovery handoff; replacement recovery remains the separately approved slice.

## Implementation

- `GET /api/v1/sync/changes` validates browser/device provenance and returns at most 100 complete events and 4 MiB per page. Signed cursors bind account, instance, recovery epoch, schema and normalization version. The maximum wait is 25 seconds.
- Mutation effects and their full records or compact bulk event commit together. Account notifications contain only ownership keys. Waiter registration precedes a second committed read; a one-second fallback covers lost notifications. Each read uses a short transaction; waiting holds neither a transaction nor a dedicated pooled connection.
- Server startup runs retention independently of account activity, deleting batches of at most 1,000 expired rows every ten seconds. Reads reject gaps or changes older than 90 days immediately. Permanent deletion/deduplication metadata is retained separately.
- The browser owns one cancellable poll. It cancels obsolete reads before refreshing scoped queries, preserves rendered rows, coalesces concurrent refresh work, and advances its checkpoint only after successful reads. Drafts remain separate from canonical saved content. Retry delays include jitter and respect server guidance.
- Native changes, canonical baseline, saved overlays, derived local search entries and checkpoint commit atomically in SQLite. Accepted uploads retire only when the corresponding server revision is applied; saved successors survive. Partial/invalid pages do not advance progress or freshness. The native poll checks cancellation every 100 ms, including while reading a bounded body, so foreground/reconnect/local-save wakeups can restart immediately.
- Freshness is the last completed catch-up check. Pending work, authentication failure, temporary errors, updating and recovery remain distinct. A remote deletion clears unavailable saved detail without destroying an open unsaved draft.
- Frequent reads exposed an existing session-renewal lock inversion. Read-side session locks now use `FOR KEY SHARE`: timestamp renewal can proceed, while DELETE-based revocation remains excluded during the read.

## Executed validation

| Command / journey | Result |
| --- | --- |
| `bun run test` | All workspace test tasks passed: 170 tests across contract, client, prototype and web suites. |
| `bun run typecheck` | All six workspace checks passed. |
| `bun x --bun ultracite check` | Formatting and lint passed. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | 42 native tests passed, including durable replay/restart, partial pages, saved successors, compact cleanup/deletion, one outstanding poll and late sign-out responses. |
| `bun --env-file=apps/web/tests/changes.env apps/web/tests/changes-runner.ts` | Disposable production build, PostgreSQL, HTTP/browser tests and independent native HTTPS clients. Notifications are suppressed in the disposable database; production code has no test switch. |
| `PR0_TEST_BROWSER=msedge bun test apps/web/tests/local-save-ui.test.ts --timeout 60000` with desktop Vite on port 1420 | Four browser/native-command tests passed: disk-full preservation, competing windows and later typing, conflict-copy drafts, remote deletion with draft and focus retained. |

The live REST checks cover missed wakeups, replay, a two-page 20-event payload exceeding 4 MiB, foreign/expired checkpoints, autonomous physical retention and a real idle 25-second poll. Three consecutive two-session browser runs cover remote saves within five seconds, unsaved drafts, list-button/editor focus and a deliberately held pre-change initial response. New saved content must appear before that obsolete response is released.

The native HTTPS journey uses two independent approved sessions, Windows Credential Manager and separate SQLite partitions. It checks bounded cancellation without changing freshness, then waits for the same browser mutation on both clients within five seconds (latest measured result: 843.6 ms for both clients). This exercises real Rust HTTPS and durable native commands; it is not a release-signed installer or Windows reboot test.

## Review

| Axis | Findings resolved | Remaining |
| --- | --- | --- |
| Standards | Duplicate/concurrent refresh paths; stale in-flight read reused during catch-up | 0 |
| Specification | List focus loss, idle-account retention, stale deleted desktop detail, pre-change read freshness, immediate native poll wakeup | 0 |

Independent reviewers checked the corrections. The fixture can also run only `http`, `browser` or `native` by appending that argument. The browser case repeats three times to exercise startup and renewal concurrency. Transient busy responses from the preexisting account settings requests remain visible in fixture logs; all library freshness and preservation assertions pass.

## Integration with desktop transitions and offline copy

PR #74 was merged with `main` at `2ac68eb` on 2026-09-21. The resolution retains account transitions and offline copy/recents alongside live updates. SQLite migration 4 remains the usage migration from `main`; live change tracking uses migration 5. The upgrade test preserves downloaded content, a saved local prompt, pending usage and recents while resetting freshness for the first live check.

Independent review identified a new ordering race between the live worker and usage acknowledgements. A usage receipt now retires atomically against the already-applied manifest, preventing a received live update from leaving the same copy counted as pending. The regression test failed before the correction and passed afterward.

Validation of the combined tree:

- Frozen-lockfile install, Ultracite fix/check, workspace type checks, workspace tests and both production builds passed. Builds used the CI placeholder API origin.
- All 66 native tests passed, including migration preservation, change-before-receipt ordering, account transitions and offline usage. Rust formatting and `cargo check --locked` passed; the latter reported a non-fatal incremental-cache permission warning.
- All six desktop browser/native journeys passed in headless Edge across the combined run and a focused rerun. The sign-out journey initially encountered a preset-server test configuration mismatch and passed after restarting Vite without a preset API origin. Draft preservation, competing windows, conflict copies, remote deletion and offline copy/recents passed in the combined run.

The PostgreSQL/HTTPS live acceptance runner and built WebView2 shell were not rerun for this merge resolution.
