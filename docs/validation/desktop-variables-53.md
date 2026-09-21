# Desktop variable copying — issue #53

The library and launcher collect transient values in their own renderer interaction. A native `copy_template` read checks the current partition and launcher eligibility. Final Copy submits the frozen template and values to Rust; Rust repeats authorization, eligibility, exact-template comparison, scalar/decimal validation, escaping and bounded UTF-8 substitution before clipboard access. Acknowledgements contain identity and usage status only. No persistence schema, REST mutation, OpenAPI payload, search index or usage record gains values or substituted text. The existing OpenAPI variable-substitution prohibition remains unchanged.

Both surfaces use the common native admission guard. The form disables editing and navigation while submitted. Launcher blur is deferred during writing; failure retains the form without refocusing it. Success clears the form and hides the same launcher opening only while it still belongs to the original partition. Sign-out invalidates renderer interactions before native cleanup starts. A started clipboard operation releases the account lock; completion checks the generation before recording usage. The OS write itself cannot be rolled back.

Template edits block Copy until explicit restart. Restart carries forward only surviving names and revalidates their effective types. Observed deletion or launcher archival discards the interaction; archive copying remains available in the library.

## Evidence

Validated on Windows with Bun 1.4.2, Rust/Tauri debug native test binaries, production Vite assets and real WebView2 on 2026-09-21.

- Before implementation: the native conformance test failed because copy inputs had no template/values; the WebView test reached a launcher result but timed out waiting for the variable field.
- 149 native tests passed. Added tests run the exact shared parser/output and validation fixtures through typed copy commands over real SQLite, reject malformed UTF-16 at deserialization, exercise 4,001 fields including a 4,000-character name, preserve templates, retain usage retry without repeating a write, reject stale templates/partitions, and finish a started write after sign-out without new-partition usage. Existing tests cover deletion, clipboard failure and overlapping library/launcher writes.
- `bun run test` passed all four test packages (189 tests, including cached unchanged packages). `bun run typecheck`, `bun x --bun ultracite check`, production desktop build and `git diff --check` passed.
- The new real-WebView journey passed: offline entry, Escape preserving query/selection, empty reentry, numeric errors, clipboard held by another Windows process, exact retained values, disabled form/navigation during a held write, nonqueued rejection from the other window, blur failure retention, explicit template restart/type revalidation, archival clearing the launcher form, library archive copying and sign-out clearing values.
- All four existing Windows launcher regression journeys passed (12 assertions), including least-privilege IPC, shortcut collisions and main-window shutdown.
- [Launcher clipboard-failure state](../evidence/issue-53-variables.png) shows the retained values and explicit retry action.
- Final Copy activation to confirmed dialog removal measured **15.4 ms** for the two-field launcher example, **17.9 ms** for exactly **262,144 output bytes**, and **30.8 ms** with **1,000 variables**. All met the **150 ms** target. The last two measurements use the library form; the 1,000-field test fills every real controlled input and verifies Tab reaches the final field. These are instrumented local samples using production renderer assets and debug native code, not population percentiles or release-hardware guarantees. Test-only clipboard gating is disabled for timing measurements.

The test process alone supports a file gate at the external clipboard boundary to make pending-write races deterministic. It writes only an entry marker, never variable values. The real Windows clipboard is used after the gate. The test worker moves focus to the native main window during the held write; native status confirms the launcher remains visible and unfocused after failure. The WebView profile uses a separate temporary directory so native sign-out cleanup retains its strict library-directory checks.

## Review

The implement skill's independent Standards review found no issues. Spec review requested real-WebView performance evidence at maximum output size and with many variables; the added bound-workload test and measurements above address that finding. Both reviewers checked the follow-up commit and reported no remaining findings.

## Reproduction

Build desktop assets with an HTTPS `VITE_API_BASE_URL`, then build `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features search-webview-test --lib --no-run`. Apply `apps/web/tests/webview.manifest` to the resulting test executable with the Windows SDK manifest tool, as in [launcher validation](quick-launcher-51.md). Run `bun test apps/web/tests/desktop-variables.test.ts` from the repository root. The test uses fixture account approval and persisted downloaded prompts; copying requires no online transport.

Canonical behavior: [variable substitution](../specs/variable-substitution-copy.md), [desktop process model](../specs/desktop-process-model.md), and [persistence amendment](../specs/persistence-sync-contract.md#variable-substitution-amendment-issue-21).
