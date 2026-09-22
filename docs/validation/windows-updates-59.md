# Issue #59 validation

Status: automated implementation checks passed; **signed installed release evidence blocked**.

On 2026-09-22 the operator confirmed that no Authenticode or updater signing setup exists. No signing credentials were created as substitutes and no signed release or installed update is claimed. Issue #59 must remain open until its signed installed acceptance journeys pass.

Implementation uses the existing native update/resident boundaries, Rust Tauri updater 2.12.0, version-bound independent signatures, native-only compiled distribution configuration, per-user NSIS and existing migration/storage ownership. No REST or OpenAPI update endpoint is added.

Automated signature fixtures generate ephemeral test keys, serve controlled loopback bytes to the real updater, and verify valid/tampered/mismatched-version behavior. HTTP loopback is enabled only under `cfg(test)`; shipped code requires HTTPS. Fixture payloads are deliberately non-executable and never install a build. These tests establish update admission and verification, not Authenticode or installed behavior.

Required operator evidence and publication procedure: [Windows releases](../operations/windows-releases.md).

## Actual checks on 2026-09-22

- `bun run check`: repository lint, formatting and Rust formatting passed.
- `bun run typecheck`: all six workspace typecheck tasks passed.
- `bun run test`: all nine workspace test/typecheck tasks passed (Turborepo reused five unchanged results).
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --features search-webview-test --locked`: 165 passed, none failed or ignored. Includes existing predecessor migration, outbox/restart and storage-failure tests.
- `bun test apps/web/tests/desktop-updates.test.ts apps/web/tests/desktop-resident.test.ts`: six real WebView2 UI journeys passed, including draft-aware quit/restart and rejection of unverified installation without losing editing access.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --example verify_update_signature --locked`: passed.
- `bun run --cwd apps/desktop tauri build --debug --bundles nsis`, with the test default instance `https://api.example.com`: packaged an x64 per-user debug installer successfully. `Get-AuthenticodeSignature` returned **NotSigned**, as expected; it was not installed or published.
- `./apps/desktop/release.ps1` with no operator configuration: refused the release at `PR0_UPDATE_PUBLIC_KEY`, before building or signing.

Host Windows version: 10.0.26200.0; Bun 1.4.2; Tauri CLI 2.11.5. The Windows native test harness needed an explicit common-controls v6 manifest; the app retains its existing Tauri resource manifest. WebView2 emitted shutdown class-unregistration messages during several completed UI journeys; all behavioral assertions and process exits passed.

Rust: 1.94.0. WebView2 installed version: 153.0.4234.48.

The code review found that direct upgrades could invoke a predecessor uninstaller before the new running-process check. The corrected NSIS initialization uses in-place upgrades, retains normal fresh-install shortcuts, and refuses unsupported machine-wide/MSI migrations. An isolated NSIS macro probe (no application installation) used a temporary HKCU fixture to verify update mode for a prior version and normal mode for a fresh installation. Before the fix the predecessor probe returned 9; after the fix it returned 0, while the fresh-install probe correctly returned 9 (normal install mode). This is supporting control-flow evidence, not an installed upgrade journey.

After the review fix, unsigned x64 NSIS packaging and `bun run check` passed again. The resulting debug installer's SHA-256 is `68E55AFC255EE2E16E81EF030CB9BD04E995CF24D74E012FB417EF4FD391021D`. Standards review: zero findings. Spec review: the installer defect is resolved; one remaining blocker is the signed installed acceptance evidence.
