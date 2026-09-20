# Email-change validation — issue #27

Date: 2026-09-20. Baseline: `d9da4465da287c5737b22ea839cba4aadf33a6d4`. Environment: Windows build 26200.9457 (25H2), Bun 1.4.2, Next.js 16.3.5, Better Auth 1.7.5, Docker Engine 29.8.0, PostgreSQL 17, and the pinned Mailpit fixture. Browser checks used Codex's Chromium 153 browser on Windows.

## Public boundaries

The public REST suite runs against the served Next.js/Bun application with real PostgreSQL and SMTP delivery. Provider responses use the existing isolated Google/GitHub fixture. Tests assert HTTP status, validated response bodies, account/library ownership, and mail received at the SMTP sink. Database writes are limited to clock, retry-schedule, log-age, and device-provenance fixtures.

The initial password test failed with 404 before its route was added, then passed. The social-only challenge test likewise failed at the missing route and passed after implementation. The replacement-email journey initially failed at its missing route and subsequently passed. A later signed-token bypass regression demonstrated that Better Auth's allowed signup-verification route also accepted email-change tokens. Restricting that route's purpose made the regression pass; Better Auth still verifies accepted signup tokens' signatures and expiry.

Fourteen email-change scenarios cover password failure, stale versions, password/browser proof isolation, social-only challenges, three failed attempts, expiry, resend, concurrent consumption, account changes, session revocation, device-provenance cookies, direct sensitive auth routes, signed email-change tokens, origin/body validation, occupied replacement addresses, and preserved account ownership. A separate SMTP outage scenario observes five actual failed delivery attempts, persistent terminal failure after delivery-log cleanup, and the verified new email remaining active.

Client coverage exercises each new method's invalid success payload, typed failure, cancellation, input validation, and same-origin mutation transport.

## Automated results

| Command / suite | Result |
| --- | --- |
| `bun run typecheck` | All six configured typecheck tasks passed. |
| `bun run test` | 85 tests passed (66 prototype, 12 API client, 7 web); unchanged tasks reused Turbo's verified cache. |
| Ultracite on changed source and test files | Passed, including integrated React Doctor rules. |
| `bun run --cwd apps/web test:email-change` | Production build and fresh schema migration passed; 14 email-change, 1 SMTP outage, 5 recovery, and 7 account tests passed. |
| `bun run --cwd apps/web test:social` | Fresh production build passed; 9 social scenarios plus 4 closed/allowlist/disabled-provider policy runs passed using the shared acceptance lifecycle. |

The production regression run exposed an older test expecting the social-login route introduced by #26 to be absent. That assertion now checks its rejection of a malformed request; the corrected complete suite passed.

## Browser journey

Performed against the local served app using disposable accounts and the local SMTP sink:

1. Signed in with email/password and opened the labeled email settings section.
2. Submitted current-password reauthentication with Enter. Focus moved to the live status message; the replacement-address input became available.
3. Tabbed from the status message into the replacement-address field and submitted with Enter. The UI explained that the old email remained active and described code expiry and the attempt limit.
4. Tabbed into the labeled code field and submitted the SMTP-delivered code with Enter. The account display changed to the new address. Settings showed SMTP acceptance without claiming inbox delivery and requested fresh authentication before another change.
5. Reloaded the page and verified the new address and notification status remained visible. The narrow browser viewport wrapped content without clipping the settings controls.
6. Signed out and completed the controlled GitHub callback for a social-only account. No real provider credentials were entered.
7. Activated the current-email code request with Enter. An incorrect code produced visible guidance and moved focus to the live status message. Entering the correct code then exposed replacement-email entry and confirmed freshness.

These are keyboard and accessibility-tree checks, not a manual screen-reader certification. No native behavior or permissions changed; no installed Windows desktop acceptance is claimed for this browser-only slice.

## Review

### Standards

Independent review found no documented-standard violations and one low-priority duplication in acceptance lifecycle code. Extracting the shared account test server resolved that finding; follow-up review reported zero remaining findings.

### Spec

Independent review reported no actionable gaps. A follow-up review of the signed email-change token guard confirmed that it blocks both current and legacy Better Auth email-change branches while retaining signature/expiry checks for signup verification.

## Tool limitation

React Doctor 0.9.14's standalone changed-scope command failed under Bun on Windows with `child.channel?.unref is not a function`, matching the limitation recorded for issue #26. No standalone score is claimed. The repository's integrated React Doctor rules passed through Ultracite on changed files.
