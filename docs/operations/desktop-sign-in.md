# Desktop sign-in

The desktop uses runtime HTTPS instance selection and explicit device approval in the system browser. Release builds retain `VITE_API_BASE_URL` as the hosted-service default; it must be the deployment's canonical HTTPS origin. “Use your own server” selects another trusted HTTPS origin before sign-in. Credentials and account data never move between instances.

Run the ordinary explicit Bun account migration before serving this version. Migration 016 adds Better Auth device-code storage after the existing prompt-use and account-deletion migrations. Initialize the independent deletion ledgers using the [account-deletion operations](account-deletion.md) before enabling desktop sign-in. Discovery returns that service's original Ed25519 anchor, and desktop sessions retain the library's existing deletion lookup handle. There is one shared source of deletion trust; replacing the instance or anchor requires recovery rather than silently trusting a replacement. Native deletion-receipt verification remains a separate slice.

The native process owns selected-origin HTTPS (redirects disabled), device-code redemption, account/session validation, and same-user Windows Credential Manager access. Only seven typed account commands are available to the local main window. The renderer receives status, public account/instance identifiers, and the matching user code; it receives neither device secrets nor bearer credentials. Remote pages have no native permissions. The old prototype launcher and relay are not exposed by the production shell.

Credential target `pr0:desktop:active:v1` contains a versioned envelope, bounded to 2,560 bytes, bound to canonical origin and immutable instance/account/session IDs. Metadata under the native application-local directory's `account-session/session-state.sqlite` retains the original trust anchor and deletion handle separately from credentials. Credential writes must succeed and read back before persistent sign-in is reported. The native generation invalidates late responses after cancellation/sign-out. A single-instance guard prevents multiple app processes from competing for the credential.

Missing, invalid, inaccessible, expired, or revoked credentials require sign-in to the same retained identity and preserve the library and pending changes indefinitely. Startup rejects known expiry and automatically checks a restored session with its instance; connectivity failures preserve the account and report that validation was unavailable. A new credential is marked usable in durable metadata only after Windows confirms its write and readback; an interrupted or failed completion requests sign-in again after restart.

In settings, **Sign out or change server** offers **Synchronize first and sign out**, **Cancel sign-out**, and an explicitly confirmed **Discard local work and sign out**. Save or close the prompt editor first so its draft cannot be lost through account cleanup. Synchronization waits for server acknowledgement of every pending operation, including receipt lookup for uncertain uploads. Accepted work does not need another download before logout. Offline, rejected or failed synchronization preserves local work. Cancellation invalidates delayed responses and leaves the account usable.

After the chosen safeguard, native cleanup invalidates in-flight generations, durably records cleanup intent, and removes the credential and the exact immutable instance/account SQLite partition, including its WAL/SHM files. Only then is the active account removed and another login permitted. Failed cleanup remains visible and retryable across restart; an unexpected file or unsafe path blocks cleanup for review. A failed or malformed remote revocation response is reported as unconfirmed; the independent desktop session remains revocable in browser settings. Browser sessions are unaffected. Ordinary authorization, suspension and network failures never authorize local deletion.

The native `auth_sign_out` request binds `instanceId`, `accountId` and `generation` to one of `synchronize`, `cancel`, `discard` or `retry_cleanup`, plus `discardConfirmed`. Rust and TypeScript validate the shared conformance examples. This is a native command change; public REST/OpenAPI and the existing main-window-only permission remain unchanged.

## Repeatable validation

Use Windows, Bun, Rust, Docker, PowerShell 7, and Chrome:

```powershell
bun run --cwd apps/web test:device
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
$env:VITE_API_BASE_URL = 'https://localhost:30440'
bun run --cwd apps/desktop tauri build --debug --no-bundle
bun test apps/web/tests/device-shell.test.ts --timeout 60000
```

The disposable fixture uses ports 30439/30440, 55439–55441, 11439, and 18439, independent of the existing social test stack. The live native test uses the production service/HTTPS client with one test-only trust root and a browser-launch boundary opened in isolated Chrome. It never installs a root certificate into Windows or changes production trust. It stores only generated credentials under unique test targets and cleans them up. The shell test opens the built executable and uses WebView2's temporary debugging endpoint on 19239 plus an untrusted test page on 19240. The local test build is not a distributable release.

See [issue 39 validation](../validation/desktop-sign-in-39.md) for measured results and remaining release gates.
