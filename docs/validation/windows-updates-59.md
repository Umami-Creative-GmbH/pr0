# Issue #59 validation

Status: automated implementation checks passed; **updater-signed installed release evidence pending**.

## Operator setup update — 2026-09-24

Issues #106 and #107 are closed with the signing-key backup and distribution decisions confirmed. The existing key pair is configured in the operator's ignored desktop environment file; the agent confirmed variable presence without printing secrets. The release entry point now loads that environment through Bun before invoking PowerShell. A checkout without configuration still fails before building. Desktop typechecking, repository checks and both review axes passed for this entry point.

The agreed default library URL is `https://pr0.umami-creative.app/`; the independent updater manifest is `https://pr0.umami-creative.app/update/`. Kai Hentschel controls manual SSH publication to `/update/releases/<version>/<filename>`. No automatic upload or new key generation is introduced.

Anonymous HTTPS verification remains unconfirmed: Bun reported `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`, Windows curl reported a Schannel/LSA error, and the external browser fetch could not access the URL. These probe failures do not establish a server-side cause and are not successful feed validation. No live artifact or manifest has been published by the agent.

The real release command subsequently built `pr0_0.1.0_x64-setup.exe` and its `.sig` with the operator's key. Independent Rust/minisign verification passed for both the signature and signed version `0.1.0`; executable and installer Authenticode status were `NotSigned`, as intended. Artifacts and `signing-evidence.json` are under `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. No installer was executed. Human follow-ups [#111](https://github.com/Umami-Creative-GmbH/pr0/issues/111) (HTTPS delivery) and [#112](https://github.com/Umami-Creative-GmbH/pr0/issues/112) (installed update journeys) are labeled `ready-for-human` and block #59.

This build exposed and fixed two integration omissions: the generated Tauri configuration now receives the same updater public key as the executable; the Bun wrapper removes the inherited PowerShell module path so Windows PowerShell can load its own signature-verification module. Before those fixes packaging rejected the empty public key, then Windows PowerShell could not load `Microsoft.PowerShell.Security`. After both fixes the complete release command exited successfully. The six isolated release-policy checks also pass with an explicit assertion that packaging receives the configured public key.

Candidate SHA-256: `B4BF0BC3A3F2E46928F25F0F60A51E29A20B3503F6B00E56D6A59244BF969EF8`. Built from `2f5a708` plus the release configuration/entry-point fixes described above, using the operator-confirmed environment. Verification timestamp: `2026-09-24T13:03:17.7700461Z`.

On 2026-09-22 the operator confirmed that no Authenticode or updater signing setup exists, then approved free Tauri updater signing with optional Windows Authenticode signing. This supersedes the original mandatory Authenticode requirement. No signing credentials were created as substitutes and no signed release or installed update is claimed. Issue #59 remains open until updater-signed installed acceptance journeys pass.

Implementation uses the existing native update/resident boundaries, Rust Tauri updater 2.12.0, version-bound independent signatures, native-only compiled distribution configuration, per-user NSIS and existing migration/storage ownership. No REST or OpenAPI update endpoint is added.

Automated signature fixtures generate ephemeral test keys, serve controlled loopback bytes to the real updater, and verify valid/tampered/mismatched-version behavior. HTTP loopback is enabled only under `cfg(test)`; shipped code requires HTTPS. Fixture payloads are deliberately non-executable and never install a build. These tests establish update admission and verification, not Authenticode or installed behavior.

Required operator evidence and publication procedure: [Windows releases](../operations/windows-releases.md).

The optional Authenticode change was checked with six isolated release-script scenarios using mocked build/signature/hash commands: the free path records `NotSigned`; updater verification failure blocks it; partial Windows signing configuration is rejected; invalid Windows signatures block the optional signed path; valid Windows signatures record `Valid`; missing updater private-key configuration still blocks a release. These checks create no keys or installers and do not establish cryptographic or installed-release evidence. Repository formatting, lint and Rust formatting passed after the change.

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
