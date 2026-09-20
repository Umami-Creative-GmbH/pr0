# Desktop sign-in

The desktop uses runtime HTTPS instance selection and explicit device approval in the system browser. Release builds retain `VITE_API_BASE_URL` as the hosted-service default; it must be the deployment's canonical HTTPS origin. “Use your own server” selects another trusted HTTPS origin before sign-in. Credentials and account data never move between instances.

Run the ordinary explicit Bun account migration before serving this version. Migration 015 adds Better Auth device-code storage, per-account deletion lookup handles, and a durable instance Ed25519 trust anchor, after the existing prompt-use migration 014. The migration command initializes a key once and retains it across restarts. Readiness requires that key. Include this material in instance backups; replacing the instance or anchor requires recovery rather than silently trusting a replacement. Receipt publication, verified rotation, deletion coordination, library download, and pending-work choices belong to dependent slices.

The native process owns selected-origin HTTPS (redirects disabled), device-code redemption, account/session validation, and same-user Windows Credential Manager access. Only seven typed account commands are available to the local main window. The renderer receives status, public account/instance identifiers, and the matching user code; it receives neither device secrets nor bearer credentials. Remote pages have no native permissions. The old prototype launcher and relay are not exposed by the production shell.

Credential target `pr0:desktop:active:v1` contains a versioned envelope, bounded to 2,560 bytes, bound to canonical origin and immutable instance/account/session IDs. Metadata under the native application-local directory's `account-session/session-state.sqlite` retains the original trust anchor and deletion handle separately from credentials. Credential writes must succeed and read back before persistent sign-in is reported. The native generation invalidates late responses after cancellation/sign-out. A single-instance guard prevents multiple app processes from competing for the credential.

Missing, invalid, inaccessible, expired, or revoked credentials require sign-in to the same retained identity and preserve files. Startup rejects known expiry and automatically checks a restored session with its instance; connectivity failures preserve the account and report that validation was unavailable. This slice has no downloaded library: the shell says so explicitly. Sign-out clears its credential and account metadata; an unexpected file in the account-session directory blocks cleanup for review by a version supporting that data. A failed or malformed remote revocation response is reported as unconfirmed; the independent session remains revocable in browser settings. Failed local cleanup is visible and retryable.

## Repeatable validation

Use Windows, Bun, Rust, Docker, PowerShell 7, and Chrome:

```powershell
bun run --cwd apps/web test:device
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
$env:VITE_API_BASE_URL = 'https://localhost:30440'
bun run --cwd apps/desktop tauri build --debug --no-bundle
bun test apps/web/tests/device-shell.test.ts --timeout 60000
```

The disposable fixture uses ports 30439/30440, 55439, 11439, and 18439, independent of the existing social test stack. The live native test uses the production service/HTTPS client with one test-only trust root and a browser-launch boundary opened in isolated Chrome. It never installs a root certificate into Windows or changes production trust. It stores only generated credentials under unique test targets and cleans them up. The shell test opens the built executable and uses WebView2's temporary debugging endpoint on 19239 plus an untrusted test page on 19240. The local test build is not a distributable release.

See [issue 39 validation](../validation/desktop-sign-in-39.md) for measured results and remaining release gates.
