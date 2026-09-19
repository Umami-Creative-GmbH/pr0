# Issue #25 validation

Validated on 2026-09-19 on Windows with Bun 1.4.2, Next.js 16.3.5, PostgreSQL in Docker Linux containers, Mailpit and the Codex in-app browser. Scope: [recover an account and manage active sessions](https://github.com/Umami-Creative-GmbH/pr0/issues/25). Reproduction commands and migration requirements are in [account operations](accounts.md).

## Automated results

| Check | Result |
| --- | --- |
| `bun run typecheck` | All six workspace typecheck tasks passed. |
| `bun run test` | 83 tests passed; unchanged Turbo tasks reused their cache. |
| Public recovery HTTP suite | Five tests, 46 assertions passed against the served production image. Also runs inside `test:recovery`. |
| `bun run --cwd apps/web test:recovery` | Two deployment tests, 36 assertions passed in 63.8 seconds, including the nested HTTP suite. |
| `bun run --cwd apps/web test:accounts` | Existing production account regression passed with migration 004: 45 assertions in 100.7 seconds, plus its seven nested public HTTP tests. |
| Production Docker build | Passed, including Next.js typechecking and bundled Bun operations. |
| Ultracite on every changed file | Passed after fix, including the integrated React Doctor rules. |
| Repository-wide `bun run check` | Existing formatting and research-harness lint failures remain outside this change. |
| Standalone React Doctor 0.9.14 | Aborted under Bun with `child.channel?.unref is not a function`; no score available. No Node fallback introduced. |

The final production image was `pr0-recovery-25`, identity `sha256:6f0ea50b64c5d750d599dcf505d117754c55e243b52313463548881118e1a130`.

Public HTTP checks cover successful verified-email recovery, old/new password behavior, revocation of previous sessions, reset-token replay, concurrent reset (one success, one refusal), selected-session revocation, all-other-session preservation, self-revocation, cross-account denial, forged origins, rejected extra fields/callbacks, and shared verification/recovery email admission. Responses for unknown and unverified accounts are indistinguishable. Client tests exercise malformed success payloads, typed failures and cancellation for each new method.

The isolated clock preload advances only the test server's JavaScript clock: activity at day 29 renews a session, another session unused at day 31 cannot read the library, list sessions or revoke sessions, and the renewed session is refused after a further 31 inactive days. Production startup has no clock override or public test endpoint.

Database fixture setup models a verified social-only account, expired recovery records and transport retry state. Assertions observe the public HTTP boundary or operator diagnostics. Recovery creates a compatible password login for the same social-only account. Expired recovery leaves credentials and the prior session usable. An SMTP outage leads to an observable terminal failure without logging the destination, password or token; the old password remains usable. A pending recovery email survives web/database recreation and later resets the account successfully. No real OAuth provider login or external email delivery is claimed.

## Regression evidence

The first recovery request failed with 404 before implementation, and the first session-list test also failed with 404. Both public journeys then passed.

Review found a password-reset/login race. A test-only database barrier pauses session insertion after actual password verification, completes reset, then allows insertion to continue. Before the fix, the old-password login retained HTTP 200 library access. With migration 004 and version-checked issuance, it receives HTTP 401; a new login with the replacement password succeeds. The deterministic regression passed in 16.6 seconds. The fixture barrier exists only in the disposable acceptance database.

## Browser acceptance

Using a disposable account and actual form controls in the in-app browser:

1. Signed in, reloaded and observed the same account/library with a distinct current-session identity, client description and activity/expiry times.
2. Requested recovery and observed the generic inbox/retry guidance receiving focus.
3. Opened the emailed fragment link; the token disappeared from the URL. Submitted mismatched passwords with Enter and observed the focused mismatch message.
4. Submitted matching passwords and observed the focused success message. Reloading the previously signed-in tab returned to sign-in. Signing in with the replacement password worked.
5. Revoked one of three separate sessions through settings, then used Enter on “Revoke all other sessions.” The current browser remained signed in with exactly one displayed session.
6. Found and corrected handling of a new email fragment while the reset page was already open in the same tab. Retested that navigation and completed another successful reset.

The narrow viewport displayed the forms and session cards without horizontal clipping. Labels, headings, accessible action names and status focus were checked through the accessibility tree. This is not a full screen-reader, zoom or cross-browser certification. Native revocation presentation remains the later desktop account-transition slice.

## Standards

The independent review found one minor naming issue in the shared email fixture. Renamed `verificationLink` to `accountEmailLink` and re-reviewed the final changes, including the authentication-version correction. No remaining documented-standard or actionable heuristic findings.

## Spec

The independent review found the concurrent old-password login issue. Added atomic version-checked session issuance, migration 004 and the failing-then-passing public HTTP regression. The reviewer confirmed the correction; no remaining findings.

Final review totals: Standards 0; Spec 0.
