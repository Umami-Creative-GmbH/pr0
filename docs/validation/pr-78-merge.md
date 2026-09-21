# PR #78 integration with main

Integrated `c4ff1ee` (desktop recovery, #47) into the offline organization branch on 2026-09-21.

Both branches used SQLite schema version 6. Version 7 detects the existing feature tables and installs the missing migration, preserving pending prompt and organization identities. Native regression coverage upgrades both prior schemas with saved work.

The merge retains both sets of native commands, permissions, UI controls and test-worker modes. Upload readiness respects replacement download recovery; organization receipt revisions are scoped to the active epoch. Organization operations from a prior epoch are archived and retained for review instead of automatically uploaded, including operations saved while the old baseline remains active. Late acknowledgements cannot release quarantined operations. Staged organization metadata no longer changes the visible baseline before activation; activation invalidates the metadata checkpoint and clears causal evidence from a different epoch.

Validation on Windows with Bun 1.4.2, Rust/Tauri, Edge and disposable PostgreSQL:

- `bun run typecheck`: all six tasks passed.
- `bun run test`: all eight tasks passed, including unchanged cached suites.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --locked`: 89 passed, including three new merge regressions and Windows clipboard/credential checks.
- `bun test apps/web/tests/local-save-ui.test.ts apps/web/tests/organization-native-ui.test.ts --timeout 60000`: eight native-backed UI journeys passed (32 assertions), with `PR0_TEST_BROWSER=msedge` and the desktop Vite server.
- Recovery production-server runner: two snapshot REST tests (139 assertions), snapshot expiry across restart, and the native HTTPS 91-day absence / restored-epoch journey passed.
- Organization production-server runner: nine REST tests (20,053 assertions) and the two-native-device HTTPS journey passed, including equivalent identity mapping, causal removal/re-add, explicit collision merge, alias chains and target deletion.
- `bun x --bun ultracite fix` / `check`, `cargo fmt`, and `git diff --check`: passed.

The first recovery runner attempt stopped because Chrome was absent; rerunning with the installed Edge browser passed. UI screenshot regeneration was excluded from this merge. These checks do not claim an installed release-signed application journey.

## Follow-up integration of service operations

Integrated `fe93446` (PR #80, service operations and abuse controls). Resolved the package exports by retaining both organization and operations contracts. Adopted the HTTPS runner's named scenario options while preserving the organization scenario and updating its caller.

The accelerated organization journey hit the new anonymous discovery budget, returning `retry_after:30` before the expected rename rejection. Only this scenario's disposable server now uses an anonymous burst/minute budget of 1,000; production defaults and the operations scenario remain unchanged. An explicit transport-status assertion now distinguishes this failure from an organization rejection.

Validation: all six typecheck tasks, all eight Bun test tasks, 90 native tests, Ultracite formatting/linting and diff checks passed. The organization runner passed nine REST tests (20,053 assertions) and its two-native-device HTTPS journey. The operations native runner passed with default limits, including explicit account suspension and preservation of downloaded prompts. Both runners built the production web server and removed their disposable containers afterward.
