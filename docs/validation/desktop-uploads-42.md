# Offline prompt upload and receipt replay — issue #42

Validated on Windows on 2026-09-20 with Bun 1.4.2, Rust/Tauri, SQLite, PostgreSQL and Chrome. This slice delivers locally saved prompt creates and text edits to the server through native HTTPS.

## Persistence and delivery

- A native background worker checks capabilities and authenticated account identity, then delivers one ready operation per bounded request. The complete envelope, installation identity, operation UUID and payload are committed as in-flight before HTTP. Network waits hold no SQLite transaction or account-state lock.
- Restarted delivery looks up the frozen operation's receipt, then replays the same envelope if its outcome is unknown. The REST boundary validates device provenance, library ownership, recovery epoch and request fingerprint under the existing account/library locks. Reusing an operation UUID with different content is refused.
- SQLite schema 3 adds frozen envelopes, compact accepted receipts, retry/error state and conflict mappings. Receipt application, baseline advancement, successor rebasing, overlay/search updates and conflict identity mapping commit together. Accepted overlays survive until the canonical snapshot contains their accepted revision. An already-applied qualifying snapshot retires them during acknowledgement.
- Post-upload snapshot requests carry `minimumRevision`. Such requests reconcile against the current locked library revision instead of reusing a stale materialized cut. This includes later remote deletion; an old receipt cannot recreate the deleted row. Ordinary resumable snapshot requests retain their existing cache behavior.
- Network failures use persistent exponential backoff with jitter. Server Retry-After delays and per-operation retry delays are retained. Quota-refused variants and their blocked successors remain available while unrelated operations continue. Authentication failure preserves saved data and requests sign-in.
- The UI distinguishes local saves, server acceptance, pending download, waiting changes and errors. Conflict acknowledgement moves an open editor's target to the preserved copy without replacing its unsaved fields. “Open original” is offered when the original remains available.

## Executed validation

| Check | Result |
| --- | --- |
| `bun run test` | Eight workspace tasks passed; 165 tests across package suites, including unchanged cached suites |
| `bun run typecheck` | All six workspace checks passed |
| `bun x --bun ultracite fix` / `check` | Formatting and integrated lint rules passed |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | 37 passed in sandbox; the remaining Windows Credential Manager persistence test passed when rerun with OS access |
| `bun --env-file=apps/web/tests/device.env apps/web/tests/uploads-runner.ts` | Production web build, two REST journeys (23 assertions), and native HTTPS/restart journey passed |
| `bun test apps/web/tests/local-save-ui.test.ts --timeout 60000` | Three native-backed browser journeys passed (14 assertions) |
| `bun test apps/web/tests/snapshot-ui.test.ts --timeout 60000` | Existing partial/offline download journey passed |
| Desktop build with `VITE_API_BASE_URL=https://instance.example` | Vite build and `tauri build --debug --no-bundle` produced the Windows executable |
| `bun test apps/web/tests/device-shell.test.ts --timeout 60000` | Built WebView2 shell passed ten assertions, including local upload status and denial of remote upload commands |

The real HTTPS journey signs in through browser device approval and Windows Credential Manager, creates B1 in native SQLite, loses its accepted response, saves B2, restarts the native process and resolves the original receipt. It verifies exact frozen-envelope replay and B2 on the web. A competing web edit then causes a lost conflict-copy acknowledgement; a later B4 successor survives another process restart, targets the returned copy and reaches the web without changing the original.

REST tests cover repeated lookup/replay, changed-payload identity reuse, native/browser credential separation, foreign-account rejection, concurrent quota admission, a mixed accepted/refused/dependency-blocked batch, and cached-at-acceptance snapshots followed by remote deletion and receipt replay.

Native tests additionally terminate child processes after freezing an upload and during the acknowledgement transaction. Reopening retains exact text, rolls back partial mappings and retries the frozen UUID through receipt lookup. A network barrier verifies that a later local edit can commit while upload waits. Authentication failure, Retry-After, quota preservation and unrelated progress are exercised through typed commands and real SQLite.

## Review and visual evidence

Independent standards and specification reviews report no remaining actionable findings. Corrections include shared receipt conformance tests, common mutation/lookup identity validation, retry jitter, deferred editor retargeting, the original-record action and current snapshot reconciliation.

[Open conflict-copy editor retaining later unsaved text](../evidence/issue-42-conflict-draft.png)

## Evidence boundaries

The HTTPS journey runs real Rust commands, SQLite, OS credentials and the production REST server. The browser editor tests bridge to the real native storage service with controlled transport and event adapters. They are distinct from an installed end-to-end upload journey; no release-signed installer, reboot or power-loss test was performed.

React Doctor 0.9.14 crashes under Bun on Windows with `child.channel?.unref is not a function`, so no standalone score is claimed. Integrated React Doctor lint rules pass. The native executable build completed with a Windows incremental-cache access warning. No Node runtime fallback was introduced.
