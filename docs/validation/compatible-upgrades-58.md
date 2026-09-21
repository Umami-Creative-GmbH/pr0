# Issue 58 validation

Validated on Windows on 2026-09-21 with Bun 1.4.2, the native Rust/Tauri service, Docker PostgreSQL 17 and Edge. Scope: [issue 58](https://github.com/Umami-Creative-GmbH/pr0/issues/58), persistence contract § compatibility/migrations, and deployment upgrades.

## Executed evidence

- Shared capability cases pass through the validated API client and typed native upload commands: legacy self-hosted server, retained protocol alongside a newer protocol, no common protocol, normalization mismatch. Incompatible responses leave pending records unchanged and downloaded/local content browsable.
- All four older SQLite schemas upgrade and their backups restore exact downloaded records and pending payloads. Version 1 predates local editing; versions 2–4 carry pending edits. A native child process is killed after transformations but before commit for every predecessor. Recovery preserves pending work. SQLite page limits produce real `SQLITE_FULL`; injected I/O failure and a real unusable backup path stop safely and retry successfully. Unknown schema 999 leaves the primary file byte-identical.
- Normalization/index replacement clears the old change checkpoint and keeps primary variants. A missing FTS table plus failed backup leaves browsing and pending work available; restarting after removing the filesystem obstruction repairs the derived index.
- The disposable public REST journey verifies legacy strict discovery, opt-in negotiation, closed admission during an interrupted coordinator, and resumed admission. A real PostgreSQL 18→19 schema upgrade creates a custom-format backup. Concurrent coordinators and backup I/O failure are refused. Exact prompt Unicode/whitespace and the original mutation receipt survive upgrade/restart. Raising the minimum compatible binary returns 503.
- The built desktop frontend connected to the real typed native service passed in Edge. Keyboard activation opens compatibility details, actionable desktop/server update guidance is visible, and the saved prompt and pending payload remain intact. Screenshot: `compatible-upgrades-58.png`.
- Workspace typechecking, the full Bun workspace test suite, Ultracite, Rust compilation/format checks and the native suite passed. Additional focused index-recovery checks passed after the full run; final review validation is recorded in the implementing commit/PR.

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
