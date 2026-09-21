# Synchronization attention and conflict review — issue #46

Implemented against `docs/specs/save-sync-conflict-presentation.md` and the persistence contract, starting at `bd56c406918512f94402a067a604b850fb278db2`.

The library status exposes coexisting pending, offline, authentication, rejection, download and freshness information. Failed editor saves remain visibly unsaved. Rejected prompt work has row indicators; rejected deletions and organization creations remain discoverable in details. Capacity failures retain their limiting resource and usage information. The launcher offers a compact status and an explicit action to open library details.

Conflict review preserves both variants and the full source title. Missing and archived originals have explicit labels. `conflict.review` and `organization.review` use scoped, replayable mutation envelopes. Reviewing does not modify prompt text or clear independent rejected work. An acknowledgement remains valid when another device has deleted the conflict copy, using the original owned receipt as evidence.

Desktop schema 10 persists notices, acknowledgements and rejection details. An acknowledgement and its queued upload commit together. Notice refresh stages bounded pages in SQLite, validates scope and revision, and activates only a complete listing. Failed or interrupted refresh retains the prior visible notices and reports an attention error. Review retries retain the frozen upload identity. Prompt availability checks read metadata rather than deserializing bodies; launcher checks use existence queries.

## Validation on Windows, 2026-09-21

- `bun run test`: all eight workspace tasks passed; 189 unit tests across the four test suites.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: 151 passed. Includes restart persistence, failed notice-page refresh, rejected review replay, organization quota details, uncertain-delivery recovery, unrelated upload progress, and migration/rollback through predecessor schemas 1–9.
- `bun run typecheck`, `bun x --bun ultracite check`, and `git diff --check`: passed.
- `VITE_API_BASE_URL=https://instance.example bun run --cwd apps/desktop build`: production renderer build passed (set the environment variable using the host shell).
- `bun test apps/web/tests/sync-presentation.test.tsx`: ten shared presentation scenarios passed, including offline rejection during download, stale freshness with authentication, accepted work awaiting download alongside pending work, review/download failure, unsaved local failure and service backoff.
- `bun test apps/web/tests/conflict-review-desktop.test.ts --timeout 60000`: passed using Edge and a real Rust/SQLite command worker. Keyboard conflict and organization reviews survive worker restart; a deleted original has no broken open action.
- From `apps/web`, `bun --env-file=tests/changes.env tests/attention-native-runner.ts`: five production REST/browser tests passed, followed by real native HTTPS notice download and acknowledgement upload. The journey includes browser approval, Windows Credential Manager, native process restart, retained full titles, canonical acknowledgements and sign-out.
- The broader prompt-edit/permanent-deletion REST regression run passed 19 tests, including capacity refusal and atomic preservation. A subsequent shared-port rerun collided with an occupied SMTP port; the final attention runner used its separate disposable ports successfully.

Desktop UI interaction uses an IPC bridge to the real native test worker. This evidence does not claim a newly packaged installer or an installed WebView smoke test. Production native commands and capabilities compile in the native suite; the renderer builds separately.

## Standards

Resolved the documented findings: incorrect provisional stale-deletion titles, missing client-boundary tests and response schemas outside the contract package. Also replaced repeated full-body status reads with metadata queries and staged paginated notice downloads instead of retaining all notices in memory. A nonblocking duplication suggestion remains: conflict and adjustment fetch entry points are separately typed, with matching staging and validation safeguards.

## Spec

Resolved hidden rejected review acknowledgements, missing organization capacity details, invisible notice-refresh failures and missing launcher presentation. The follow-up mixed-state wording finding is fixed and covered by the accepted-awaiting-download and service-backoff scenarios.

Review totals: Standards 0 open documented violations and 1 nonblocking maintainability suggestion; Spec 0 open findings. The issue remains open until an implementing PR merges.
