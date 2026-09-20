# Issue 39 validation

Executed on Windows on 2026-09-20 using Bun 1.4.2, Rust 1.94, Better Auth 1.7.5, Next.js 16.3.5, PostgreSQL 17, Chrome, and WebView2.

## Observed results

- Full workspace suite: 98 tests passed; the additional device-client validation test passed in its focused suite afterward. All six workspace typecheck tasks passed. The final native suite passed 15 tests (including the helper entry points used by process tests).

- Served production Next.js/Bun application: seven device acceptance tests, 55 assertions passed. Includes verified email login in Chrome with keyboard approval; independent browser/device sessions; pending, deny, cancel and forged-origin behavior; concurrent one-use redemption; lost-response retry; expected-account guard; device credentials copied into a correctly signed browser cookie denied browser privileges; enabled social sessions using the identical approval route.
- Served process restart: device session, original Ed25519 trust anchor and deletion handle survived. A test-only clock advanced beyond code expiry; redemption returned `expired_token`.
- Complete native journey passed: production Rust HTTPS transport to the local TLS fixture, matching code approved in Chrome after email login, real Windows Credential Manager write/read, process exit and restart, authenticated session refresh, and independent device sign-out. A test-only trust root and browser-launch adapter isolate the fixture; production certificate policy is unchanged.
- Native service tests passed for invalid origins, durable reopen with automatic session validation, expired/revoked restored sessions, missing/corrupt/inaccessible credentials, local-file preservation, failed credential persistence, sign-out with malformed response rejection, real same-user Credential Manager access from a new process, late redemption after cancel, approval expiry, and account-switch rejection.
- Actual built Tauri executable/WebView2 test passed six assertions: shell renders, returned status has no token, removed generic relay is denied, HTTP origin rejected, and remote content cannot invoke native account commands. The shell screenshot was visually inspected.
- Tauri debug executable with embedded frontend built successfully. This is a local acceptance artifact using the fixture default, not an installer or signed release.

## Scope and tooling limits

This slice enables account access only. It deliberately exposes no local prompt edits or library-download completion. Pending-work decisions, installed update/reboot/second-Windows-user ACL release checks, provider-operated Google/GitHub journeys, receipt verification/rotation, and deletion restoration remain their respective dependent release gates.

React Doctor 0.9.14 was attempted with `bun x --bun react-doctor@latest --verbose --scope changed`; its worker crashed because Bun's child-process channel has no `unref` method. No Node fallback was introduced. The repository's bundled React Doctor/Oxlint rules run with the normal lint check. A repository-wide formatter invocation also found existing lint failures in research harnesses; unrelated formatter changes were reverted.
