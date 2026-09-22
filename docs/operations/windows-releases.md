# Windows releases

Official pr0 is a per-user Windows x64 NSIS application. Umami operates its signing and direct-download channel independently of the user's selected library instance. A custom fork must change the application identity, signing keys and distribution configuration. Never use an instance's capabilities or session response as an executable-update source.

## Operator setup

On a Windows signing host, install the repository's Bun and Rust toolchains and Windows SDK signing tools. Obtain a trusted Authenticode code-signing certificate with its provider-supported private-key access. Generate and securely retain a separate Tauri updater key pair using `bun run --cwd apps/desktop tauri signer generate`. Keep private keys and passwords outside the repository and task messages. Losing the updater key prevents existing clients from trusting later releases.

Configure these environment variables in the signing host or protected CI environment:

| Variable | Purpose |
| --- | --- |
| `PR0_AUTHENTICODE_THUMBPRINT` | Certificate thumbprint used by SignTool; the signing host must have access to its private key. |
| `PR0_TIMESTAMP_URL` | HTTPS RFC 3161 timestamp service supported by the signing provider. |
| `PR0_UPDATE_PUBLIC_KEY` | Base64 public key from Tauri's signer. Compiled into the native executable. |
| `PR0_UPDATE_ENDPOINT` | Operator-controlled HTTPS updater manifest URL, compiled into the native executable. |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri private-key file path or value, supplied only to the release process. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Private-key password if applicable. |
| `VITE_API_BASE_URL` | Default library instance; this does not control updates. |

Choose the endpoint before shipping the first release and preserve access to it for supported predecessors. Never modify the updater public key in a patch without a separately designed trust-continuity plan. The operator chooses the download host; no account credential is sent to that host. Ordinary development builds without update configuration display an explicit unavailable state.

## Build and verification

Update application versions consistently in the desktop package, Cargo manifest/lockfile and Tauri configuration. Run repository checks, typechecking, Bun tests and native tests. From the repository root run:

```powershell
./apps/desktop/release.ps1
```

This builds only `x86_64-pc-windows-msvc` NSIS artifacts, requires both signing configurations, verifies the executable and installer Authenticode certificate and timestamp, then independently verifies the updater signature and signed version. It writes `signing-evidence.json` beside the installer. A failed gate prevents any release claim. The script never publishes. Tauri CLI 2.11.5 or later supplies the signed version required by updater 2.12.0.

The native updater downloads and verifies before offering **Install update and restart**. The resident quit flow waits for local saves and offers Save, Discard draft and Cancel for dirty editors. Cancellation leaves the verified download available during the process lifetime. Earlier saved work remains in the same application data directory, including library/outbox identities, migration backups and startup preferences. Downloads are not persisted between application restarts.

The installer refuses to force-close a running application. The NSIS hook replaces Tauri's default force-shutdown check for installation and uninstallation. If another launch races with setup, close it through Quit pr0 and retry. Tauri's installer restarts the application after a successful passive update; existing per-user resident ownership prevents a second writer. The existing ordered migrations run at normal startup; update handling never clears data or requests a downgrade. If setup fails after handoff, reopen pr0 from Start; the retained attempt marker shows recovery until a matching version starts or the user retries the download.

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

Use signed current/prior-version builds on supported Windows 11 x64 with current WebView2. Retain OS, WebView2, application and hardware versions, installer hashes, certificate/thumbprint/timestamp results, source commit, logs and screenshots for each journey:

1. Install as a standard user without elevation; verify the per-user path, library, tray, launcher and one resident owner. Repeat with another Windows user to establish isolation.
2. With startup enabled, externally disabled, and disabled, update each supported predecessor. Verify the exact preference and one resident with working entry points after restart.
3. Create offline prompt/organization/usage work, including uncertain-delivery successors and pending conflicts. Record public native state before update and after reopening; reconnect and verify acknowledgement without duplicates or lost local variants.
4. Exercise dirty drafts with Save, Discard draft, Cancel, a pending save, failed save and a later edit during a pending save. Verify exact draft text and focus. Run a direct installer while the resident is open; verify it refuses to close the app.
5. Interrupt download, reject an invalid signature and a valid signature paired with another announced version, deny installer launch, cancel setup, and simulate insufficient disk/access. Verify actionable recovery and preserved pending work. Reopen the old build after failed setup and verify its recovery message survives the automatic update check.
6. Exercise migration interruption/storage failures using the supported predecessor fixtures and confirm existing recovery behavior. Launch during setup and confirm no forced draft loss or simultaneous library writers.
7. Select a self-hosted instance whose API advertises arbitrary update URLs; verify the binary still contacts only its compiled update channel and accepts only its own updater signatures.

No signed evidence exists until an operator performs these journeys. Test-only generated keys and unsigned packaging checks cannot satisfy this gate.

References: [Tauri updater](https://v2.tauri.app/plugin/updater/), [Windows signing](https://v2.tauri.app/distribute/sign/windows/), [NSIS installer](https://v2.tauri.app/distribute/windows-installer/).
