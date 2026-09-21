# Offline collections and tags — issue #45

Validated on Windows on 2026-09-21 using Bun 1.4.2, Rust/Tauri, SQLite, PostgreSQL and Edge.

## Behavior and persistence

The desktop management dialog and searchable collection/tag pickers use typed native commands. Creates, renames, assignments, deletion and explicit tag merges commit their projection, dependencies and local receipts in one SQLite transaction. Names use shared Unicode 17 identity fixtures. Local quota checks cover 200 collections, 1,000 tags, 20 tags per prompt and library text bytes. Rename operations retain prompt modification dates; membership changes advance them.

Schema 6 adds the organization queue, compact causal acknowledgements, local projection, removal evidence, aliases and original affected-prompt identities. Saved effects can be reopened after restart. Counts explicitly describe the available snapshot; local commit and server acceptance remain distinct. Deleted/merged selected filter identities continue returning no matches until the user removes or replaces them.

Delivery freezes an envelope before HTTP and resolves uncertain outcomes using the existing receipt protocol. Corrections receive a new UUID only after a known rejection. Equivalent tag creation remaps unsent dependants atomically, including when a rejected creation is corrected to an existing tag. Pending target dependencies are captured before source remapping, excluding downstream operations. Rejected organization creation blocks dependent prompt creation while unrelated work can continue.

Tag-add causal revisions incorporate only observed removals of that membership, including accepted removals awaiting download. Unrelated prompt receipts cannot establish observation of a remote removal. Multi-tag local saves remain atomic but queue individual additions so each retains its own causal basis. The causal ledger retains identifiers and operation kinds, not copies of prompt text.

Live changes carry explicit removal evidence even when removal did not alter the visible prompt. Replacement-snapshot reconciliation uses bounded, authenticated organization-state reads and rejects metadata from a different library revision. Intermediate alias-path removal evidence is attributed to the requested identity. The shared response validators and OpenAPI describe the optional prompt identity parameter and desktop authentication.

Rejected cleanup offers a fresh confirmation. Its preview temporarily removes the rejected projection inside a rolled-back transaction; cancellation preserves the saved intent and does not attach its replacement UUID to another draft.

## Executed checks

| Check | Result |
| --- | --- |
| `bun run test` | All eight workspace tasks passed; unchanged cached suites included |
| Shared native/TypeScript Unicode conformance | Passed, including composed/decomposed accents, sharp S, sigma, dotted I, Hangul, whitespace and distinct internal spacing |
| `bun run typecheck` | All six workspace checks passed |
| `bun x --bun ultracite fix` / `check` | Formatting and lint passed |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | 79 tests passed, including Windows clipboard and credential persistence |
| `bun --env-file=apps/web/tests/changes.env apps/web/tests/organization-native-runner.ts` | Production web build, nine REST tests and the two-native-device HTTPS journey passed |
| `bun test apps/web/tests/local-save-ui.test.ts --timeout 60000` with `PR0_TEST_BROWSER=msedge` | Five existing native-backed editor/transition regressions passed |
| `bun test apps/web/tests/organization-native-ui.test.ts --timeout 60000` with `PR0_TEST_BROWSER=msedge` | Both organization journeys passed |
| `bun run --cwd apps/desktop tauri build --debug --no-bundle` with an HTTPS API origin | Windows executable and production frontend built successfully |

The HTTPS journey exercises equivalent creation on two devices, pending assignment identity mapping, removal precedence, deliberate re-add, a remote rename collision followed by explicit merge, alias chains, target deletion and retained collection-name correction. The REST suite also exercises failed-transaction rollback and deletion/merge of 10,000 prompts, verifying all 100 affected-review pages.

Native regressions cover dependency coalescing, two queued renames after corrected identity reuse, re-add both before and after removal acknowledgement, unrelated accepted edits, rolled-back cleanup previews, local quota refusal, replacement snapshots and restart. Browser checks use the real native SQLite service, preserve invalid drafts, require explicit merge approval, reopen saved effects after restart and search the final entries at full organization capacity. The capacity check uses a 640×360 CSS viewport with device scale factor 2, equivalent to the layout space of a 1280×720 display at 200% zoom; keyboard activation closes the dialog.

## Review and evidence

| Review | Result |
| --- | --- |
| Standards | No remaining actionable findings after dependency and correction fixes |
| Specification | No remaining actionable findings after causal and recovery fixes |

- [Saved merge and affected-prompt review](../evidence/issue-45-native-review.png)
- [Full-capacity collection search in the zoom-equivalent viewport](../evidence/issue-45-capacity-zoom.png)

The HTTPS tests execute real Rust commands, SQLite, Windows credentials and the production server. Browser tests bridge the UI to native commands with controlled transport/event adapters. The executable was built; no release-signed installer or installed end-to-end UI journey is claimed.
