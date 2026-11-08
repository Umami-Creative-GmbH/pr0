# Windows releases

Official pr0 is a per-user Windows x64 NSIS application. Umami operates its signing and direct-download channel independently of the user's selected library instance. A custom fork must change the application identity, signing keys and distribution configuration. Never use an instance's capabilities or session response as an executable-update source.

## Operator setup

The default release path needs no purchased certificate: Tauri updater signatures are required, while Windows Authenticode publisher signing is optional. Windows may show an unknown-publisher or SmartScreen warning for the default installer.

On a Windows build host, install the repository's Bun and Rust toolchains. Generate a free Tauri updater key pair once using `bun run --cwd apps/desktop tauri signer generate --write-keys <private-path-outside-repository>`. Keep the private key and password outside the repository and task messages, retain a secure backup, and supply them to a protected release environment (for GitHub Actions, use repository/environment secrets). The public key is safe to configure as a variable. Losing the updater key prevents existing clients from trusting later releases. Generating keys does not publish a release.

To add Windows publisher signing later, obtain a trusted Authenticode code-signing certificate with provider-supported private-key access and install the Windows SDK signing tools. Leave both optional Windows signing variables unset for the free release path. A partially configured Windows signing setup is rejected.

Configure these environment variables in the signing host or protected CI environment:

| Variable | Purpose |
| --- | --- |
| `PR0_AUTHENTICODE_THUMBPRINT` | Optional: certificate thumbprint used by SignTool; the signing host must have access to its private key. |
| `PR0_TIMESTAMP_URL` | Optional, required with the thumbprint: HTTPS RFC 3161 timestamp service supported by the signing provider. |
| `PR0_UPDATE_PUBLIC_KEY` | Base64 public key from Tauri's signer. Compiled into the native executable. |
| `PR0_UPDATE_ENDPOINT` | Operator-controlled HTTPS updater manifest URL, compiled into the native executable. |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri private-key file path or value, supplied only to the release process. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Private-key password if applicable. |
| `VITE_API_BASE_URL` | Default library instance; this does not control updates. |

Choose the endpoint before shipping the first release and preserve access to it for supported predecessors. Never modify the updater public key in a patch without a separately designed trust-continuity plan. The operator chooses the download host; no account credential is sent to that host. Ordinary development builds without update configuration display an explicit unavailable state.

## Build and verification

The operator decisions in [#106](https://github.com/Umami-Creative-GmbH/pr0/issues/106) and [#107](https://github.com/Umami-Creative-GmbH/pr0/issues/107) are complete. Use the existing backed-up signing pair. The official manifest endpoint is `https://pr0.umami-creative.app/update/`; immutable artifacts belong at `https://pr0.umami-creative.app/update/releases/<version>/<filename>`. Kai Hentschel approves each release and uploads it manually over SSH using protected operator access. No CI upload credential or automated publication job is required.

The Bun release entry point loads `apps/desktop/.env` before starting PowerShell and passes configuration through the environment without printing secrets. Keep that file ignored. The PowerShell script can also run directly when the process environment is already configured. A file in another checkout is not loaded automatically; explicitly supply its path with Bun's `--env-file` option when invoking the entry point.

The confirmed default library URL is `VITE_API_BASE_URL=https://pr0.umami-creative.app/`. Set it in the release environment alongside the separate `PR0_UPDATE_ENDPOINT=https://pr0.umami-creative.app/update/`.

Update application versions consistently in the desktop package, Cargo manifest/lockfile and Tauri configuration. Run repository checks, typechecking, Bun tests and native tests. From the repository root run:

```powershell
bun run --cwd apps/desktop release
```

This builds only `x86_64-pc-windows-msvc` NSIS artifacts, requires updater signing configuration and independently verifies the updater signature and signed version. With optional Windows signing configured, it also verifies the executable and installer Authenticode certificate and timestamp; without it, both must report `NotSigned`. It writes `signing-evidence.json` beside the installer. A failed gate prevents any release claim. The script never publishes. Tauri CLI 2.11.5 or later supplies the signed version required by updater 2.12.0.

The native updater downloads and verifies before offering **Install update and restart**. The resident quit flow waits for local saves and offers Save, Discard draft and Cancel for dirty editors. Cancellation leaves the verified download available during the process lifetime. Earlier saved work remains in the same application data directory, including library/outbox identities, migration backups and startup preferences. Downloads are not persisted between application restarts.

The installer refuses to force-close a running application. The NSIS hook replaces Tauri's default force-shutdown check for installation and uninstallation. Existing per-user NSIS applications upgrade in place, bypassing predecessor uninstallers that could force-close drafts. Direct setup shows progress without a reinstall/uninstall choice; fresh installs still create shortcuts. Machine-wide/MSI migrations are rejected before their uninstaller can run and require distributor-guided migration. If another launch races with setup, close it through Quit pr0 and retry. Tauri's installer restarts the application after a successful in-app update; existing per-user resident ownership prevents a second writer. Direct-download installers can be launched with `/R` to restart afterward, or the user can open pr0 from Start. The existing ordered migrations run at normal startup; update handling never clears data or requests a downgrade. If setup fails after handoff, reopen pr0 from Start; the retained attempt marker shows recovery until a matching version starts or the user retries the download.

## Publish direct downloads and update metadata

After the installed validation below, upload the exact verified installer and `.sig` to immutable HTTPS URLs. Offer that installer on the official download page. Prepare the following manifest with the actual release version, installer URL and **contents** of its `.sig` file:

```json
{
  "version": "0.2.0",
  "notes": "Release notes for this version.",
  "platforms": {
    "windows-x86_64": {
      "url": "https://downloads.example.invalid/pr0/0.2.0/pr0_0.2.0_x64-setup.exe",
      "signature": "REPLACE_WITH_THE_VERIFIED_SIG_FILE_CONTENTS"
    }
  }
}
```

The example domain is not configured in the application. Verify the uploaded bytes against `signing-evidence.json` and repeat the independent signature check on the downloaded artifact. Publish the manifest at `PR0_UPDATE_ENDPOINT` only after the immutable files are available and installed checks pass. Retain artifacts and evidence for every supported predecessor from the preceding 90 days. A failed release should be withdrawn from the feed; never roll back library schemas or reuse a version for different bytes.

## Installed release gate

Use updater-signed current/prior-version builds on supported Windows 11 x64 with current WebView2. Retain OS, WebView2, application and hardware versions, installer hashes, Authenticode status (and certificate/thumbprint/timestamp results when enabled), source commit, logs and screenshots for each journey:

1. Install as a standard user without elevation; verify the per-user path, library, tray, launcher and one resident owner. Repeat with another Windows user to establish isolation.
2. With startup enabled, externally disabled, and disabled, update each supported predecessor. Verify the exact preference and one resident with working entry points after restart.
3. Create offline prompt/organization/usage work, including uncertain-delivery successors and pending conflicts. Record public native state before update and after reopening; reconnect and verify acknowledgement without duplicates or lost local variants.
4. Exercise dirty drafts with Save, Discard draft, Cancel, a pending save, failed save and a later edit during a pending save. Verify exact draft text and focus. Run a direct installer while the resident is open; verify it refuses to close the app.
5. Interrupt download, reject an invalid signature and a valid signature paired with another announced version, deny installer launch, cancel setup, and simulate insufficient disk/access. Verify actionable recovery and preserved pending work. Reopen the old build after failed setup and verify its recovery message survives the automatic update check.
6. Exercise migration interruption/storage failures using the supported predecessor fixtures and confirm existing recovery behavior. Launch during setup and confirm no forced draft loss or simultaneous library writers.
7. Select a self-hosted instance whose API advertises arbitrary update URLs; verify the binary still contacts only its compiled update channel and accepts only its own updater signatures.

No installed release evidence exists until an operator performs these journeys. Test-only generated keys and packaging checks without updater signatures cannot satisfy this gate. An Authenticode-unsigned installer with a verified updater signature is supported; record its Windows warning and `NotSigned` status.

References: [Tauri updater](https://v2.tauri.app/plugin/updater/), [Windows signing](https://v2.tauri.app/distribute/sign/windows/), [NSIS installer](https://v2.tauri.app/distribute/windows-installer/).
