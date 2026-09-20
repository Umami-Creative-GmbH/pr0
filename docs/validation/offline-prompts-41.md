# Durable offline prompt saves — issue #41

Validated on Windows on 2026-09-20 using Bun 1.4.2, Rust/Tauri, SQLite and Chrome. This slice builds on the durable download implementation from #40. It implements local create/edit and durable pending operations; server delivery and reconciliation remain separate work.

## Contract and storage

- Main-window-only typed commands `library_create`, `library_edit`, `library_editor` and `library_copy_draft` expose the active account's editor boundary. Write/copy requests validate the retained instance/account and session generation. Shared TypeScript schemas and Rust validation enforce the same canonical prompt text rules. Twelve shared fixtures cover Unicode code-point limits, UTF-8 byte limits, whitespace, NUL and invalid scalar rejection. Existing REST/OpenAPI behavior is unchanged.
- SQLite schema 2 adds an overlay, local revision token, installation identity, search projection, pending operations and compact save receipts. The existing native-owned connection retains WAL, FULL synchronization, foreign keys and a bounded busy timeout. One immediate transaction commits the prompt, normalized search data, local revision, baseline/dependencies, pending operation and receipt before the command acknowledges success.
- Search writes include normalized fields, per-field trigram indexes and compact one/two-scalar postings using the pinned Unicode data. This slice maintains the saved overlay's index; full desktop search and baseline indexing are separate work.
- Request identities remain frozen across uncertain results. Receipts store request fingerprints and projection hashes, without accumulating historical prompt text. A retry confirms the committed variant, or reports that a newer edit superseded it. An unchanged edit preserves dates and creates no new pending mutation.
- Only unsent operations coalesce. Frozen operations retain their payload and identity; subsequent edits become dependent successors. Downloaded pages cannot overwrite local overlays. Native stale-revision checks preserve a competing window's draft.
- Known prompt/text usage includes snapshot totals during partial downloads. Growth beyond capacity is refused while reductions remain possible. New local timestamps are explicitly provisional until server acceptance.
- Native sign-out refuses pending work before credential revocation or file cleanup. The UI disables account changes while an account is retained until the complete account-change workflow exists, preserving both committed work and active drafts.

## Editor behavior

Save success is displayed only after native commit confirmation. Disk-full, storage refusal and uncertain responses keep the entire draft available with Retry and Copy text. Copy uses the native clipboard command and reports failure without discarding text. Inputs remain editable during a save; an acknowledgement for an older submission cannot certify newer typing. Discard confirmation is disabled during the save.

Other-window changes and focus refresh authoritative lists and open details without replacing an active draft. Competing edits report a conflict and allow copying or saving a separate prompt. Ambient status distinguishes offline and pending work from local save state.

## Executed validation

- `bun run test`: all eight workspace tasks passed (164 tests across the package suites).
- `bun run typecheck`: all six workspace type checks passed.
- `bun x --bun ultracite check`: formatting and lint passed, including integrated React Doctor rules.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: 32 tests passed. Coverage includes exact text after restart, provisional/unchanged dates, Unicode/size validation, quota refusal/reduction, stale windows, frozen-operation successors, snapshot overlap, receipt replay, pending-work sign-out protection and Windows Credential Manager persistence.
- Native fault checks use real SQLite full-page and write-refusal errors, plus a lost post-commit acknowledgement. Controlled child-process termination after projection writes, immediately before commit and immediately after commit verifies that prompt and pending operation survive together or roll back together.
- `bun test apps/web/tests/local-save-ui.test.ts`: two browser journeys drive the real native service over a test adapter. They cover disk full, write refusal, uncertain/malformed replies, retry, process restart, exact text, two competing windows, typing during a held acknowledgement and discard protection. `snapshot-ui.test.ts` also passed with the extended command contract.
- `VITE_API_BASE_URL=https://instance.example bun run --cwd apps/desktop tauri build --debug --no-bundle`: the Windows desktop executable built successfully. The WebView2 `device-shell.test.ts` passed (one test, eight assertions), including denial of remote access to the new typed commands.

## Review

| Review | Corrections verified | Remaining findings |
| --- | --- | --- |
| Standards | Projection-hash receipts; typed pending-operation variants | 0 |
| Specification | No-op receipt replay after unrelated writes; discard during save; frozen retry after malformed acknowledgement; selected-detail refresh | 0 |

Both independent reviewers inspected the corrections. Regression tests reproduce the receipt and discard failures before the fixes.

## Visual evidence

- [Disk-full draft with Retry and Copy text](../evidence/issue-41-disk-full.png)
- [Locally saved prompt with pending status](../evidence/issue-41-offline-save.png)
- [Competing window's preserved draft](../evidence/issue-41-two-window.png)

## Evidence boundaries

The browser save journeys use real native storage and transactions, with fixture authentication and substituted event/clipboard bridges. They do not constitute a complete save journey through an installed WebView2 app. The separately built WebView2 shell verifies native command exposure and remote denial. The clipboard success callback is substituted in these browser tests; actual OS clipboard contents were not asserted.

Controlled process termination was exercised; a Windows reboot, abrupt machine power loss and a release-signed installer were not. No synchronization delivery is claimed. The build emitted a Windows incremental-cache access warning while completing successfully. React Doctor 0.9.14 failed under Bun with `child.channel?.unref is not a function`, so it produced no standalone score; integrated lint checks passed. No Node runtime fallback was introduced.
