# Safe desktop sign-out and reauthentication — issue #48

Validated on Windows on 2026-09-21 with Bun 1.4.2, Rust/Tauri, SQLite, Windows Credential Manager, Edge/WebView2 and disposable PostgreSQL/SMTP services.

## Behavior

- Settings offer synchronize first, cancel, and an explicitly confirmed discard. An open editor must be saved or closed before beginning sign-out. The current email, immutable account ID and server remain visible.
- Synchronize first checks current session authority and waits for acknowledged operations. An uncertain upload retains its frozen identity and resolves through receipt replay. Offline, rejected, incomplete and failed synchronization never authorize cleanup. Already acknowledged operations do not require a redundant download before cleanup.
- Cancellation invalidates in-flight generations without deleting local data or credentials. Discard and completed synchronization durably mark cleanup pending, invalidate responses, clear the Windows credential and remove only the exact active account/instance SQLite files. New login and download remain blocked until cleanup succeeds.
- Cleanup failure survives restart with a retry action, including when Windows refuses credential deletion or another Windows file handle prevents deleting the library. A credential write whose readback cannot be confirmed stays incomplete across restart and can be retried through sign-in.
- Missing, expired and revoked credentials retain local prompts and pending edits. Reauthentication accepts only the same immutable account on the same instance. A different account with the same email is rejected until deliberate cleanup; another instance with the same email starts with an empty local partition afterward. Unauthorized and network responses never authorize deletion.
- Local sign-out reports when remote revocation is unconfirmed. The public desktop sign-out REST endpoint continues to revoke only its independent bearer session; browser sessions are unaffected. No REST schema, OpenAPI or native permission expansion is needed. Shared Rust/TypeScript fixtures validate the changed native command request.

## Executed checks

| Check | Result |
| --- | --- |
| `bun run typecheck` | All six workspace checks passed |
| `bun run test` | All eight workspace tasks passed, including nine new native-contract fixtures |
| Native Rust suite | All 50 tests passed with OS access, including real Windows Credential Manager persistence and filesystem cleanup failure |
| Ultracite fix/check and Rust formatting | Passed |
| `bun test apps/web/tests/local-save-ui.test.ts --timeout 60000` with `PR0_TEST_BROWSER=msedge` | Four native-backed browser journeys passed, 21 assertions |
| `bun --env-file=apps/web/tests/device.env apps/web/tests/transitions-runner.ts` | Production Next.js/Bun build and 12 REST acceptance tests passed, 105 assertions; isolated Docker fixtures removed afterward |
| `bun run --cwd apps/desktop tauri build --debug --no-bundle` | Windows executable built successfully |
| `bun test apps/web/tests/device-shell.test.ts --timeout 60000` | Built WebView2 shell passed 12 assertions, including malformed sign-out rejection and remote native-command denial |

The native transition tests use real SQLite and controlled transport/credential boundaries. They cover cancellation while an upload waits, uncertain receipt replay after restart, failed synchronization preserving exact text, confirmed discard, stale generations after cleanup, same-email account/instance isolation, credential persistence and cleanup failures. The filesystem cleanup failure uses a real Windows handle that denies delete sharing. The separate-process Windows credential test uses an isolated generated test target.

The settings journey creates pending text, cancels sign-out, observes failed synchronization, restarts the native service, verifies the original text, confirms discard and reaches editable server selection with an honest remote-revocation warning. Existing draft/conflict journeys remain green.

[Settings with pending local work and explicit discard confirmation](../evidence/issue-48-sign-out.png)

Independent Standards and Spec reviews found no actionable issues against the task's starting commit `74012ce`.

## Evidence limits

The settings test runs the real native storage service through the typed command bridge with controlled transport; the built-shell check runs actual WebView2 and command permissions. This is not a release-signed installer, reboot or complete installed-account journey. Reset/revocation behavior is verified at the public REST boundary and retained offline behavior at native command boundaries. Native deletion-receipt verification remains outside this slice; no generic failure is treated as deletion proof. Chrome is absent on this host, so the browser regression suite was run with installed Edge.
