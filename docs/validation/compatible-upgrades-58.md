# Issue 58 validation

Validated on Windows on 2026-09-21 with Bun 1.4.2, the native Rust/Tauri service, Docker PostgreSQL 17 and Edge. Scope: [issue 58](https://github.com/Umami-Creative-GmbH/pr0/issues/58), persistence contract § compatibility/migrations, and deployment upgrades.

## Executed evidence

- Shared capability cases pass through the validated API client and typed native upload commands: legacy self-hosted server, retained protocol alongside a newer protocol, no common protocol, normalization mismatch. Incompatible responses leave pending records unchanged and downloaded/local content browsable.
- All seven older SQLite schemas upgrade and their backups restore exact downloaded records and pending payloads. Version 1 predates local editing; versions 2–7 carry pending edits. A native child process is killed after transformations but before commit for every predecessor. Recovery preserves pending work. SQLite page limits produce real `SQLITE_FULL`; injected I/O failure and a real unusable backup path stop safely and retry successfully. Unknown schema 999 leaves the primary file byte-identical.
- Normalization/index replacement clears the old change checkpoint and keeps primary variants. A missing FTS table plus failed backup leaves browsing and pending work available; restarting after removing the filesystem obstruction repairs the derived index. A missing short-postings table is rebuilt on reopen, preserving pending work and allowing another save; this regression failed before the review fix and passed afterward. Schemas 3–4 retain frozen envelopes, receipt replay and successor baselines; schema 4 also retains pending usage.
- The disposable public REST journey verifies legacy strict discovery, opt-in negotiation, closed admission during an interrupted coordinator, and resumed admission. A real PostgreSQL 19→20 schema upgrade creates a custom-format backup. Concurrent coordinators and backup I/O failure are refused. Exact prompt Unicode/whitespace and the original mutation receipt survive upgrade/restart. Raising the minimum compatible binary returns 503.
- The built desktop frontend connected to the real typed native service passed in Edge. Keyboard activation opens compatibility details, actionable desktop/server update guidance is visible, and the saved prompt and pending payload remain intact. Screenshot: `compatible-upgrades-58.png`.
- Workspace typechecking, the full Bun workspace test suite, Ultracite, Rust compilation/format checks and all 119 native tests passed. The native suite requires Windows Credential Manager access for its isolated cross-process credential test; the sandbox denied that access, and the complete rerun with access passed. The server upgrade journey passed again after the final backup durability change. Standards and spec reviews reported no remaining findings after the short-postings repair and the runbook correction requiring all background writers to stop for every migration.

## PR 81 merge validation

Merged main at 52f7654. SQLite migrations now include recovery, organization and search through schema 8 inside the same backup-backed transaction. Existing schema-6/7 feature combinations retain their primary and pending work. Automatic index recovery rebuilds the complete search projection, including organization names and memberships; explicit rebuild remains available. Server migration 19 retains its service-operations checksum; compatible upgrades follow as migration 20. The detailed readiness response retains all operational checks and also observes migration admission.

The merged tree passed all 119 native tests, root unit tests, workspace typechecking, Ultracite, desktop production build, the Docker-backed server 19→20 journey, and four Edge UI checks (compatibility, search, two organization scenarios). The compatibility UI fixture now selects the saved prompt from the search results before inspecting its local status.

## Reproduce

```powershell
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --locked
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
docker build --target migration-runtime -t pr0-migration-test-58 .
bun --env-file=apps/web/tests/compatibility.env apps/web/tests/compatibility-runner.ts
$env:VITE_API_BASE_URL = 'https://instance.example'
bun run --cwd apps/desktop build
bun run --cwd apps/desktop preview --host 127.0.0.1 --port 14558
# In another terminal:
$env:PR0_DESKTOP_TEST_URL = 'http://127.0.0.1:14558'
$env:PR0_TEST_BROWSER = 'msedge'
bun test apps/web/tests/compatibility-ui.test.ts --timeout 60000
```

The server fixture owns ports 31458, 58458–58460, 12458 and 19458 and disposes only its generated data. Its credentials are public disposable test values. Native tests use unique temporary partitions and generated credential targets. No production data is used.

## Evidence limits

No GitHub desktop release exists in the preceding 90 days (`gh release list` returned an empty list). The predecessor evidence is schema-fixture and native-process evidence, not a claim of signed installer upgrade testing. A published installer must be added to the retained-data upgrade matrix at release time. Power loss, physical volume exhaustion, hostile same-user file replacement, encrypted off-server backup recovery and disaster restore objectives were not certified by this run. The UI test exercises the production frontend/native command boundary through a browser bridge, not an installed WebView2 binary.
