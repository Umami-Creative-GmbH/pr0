# Issue #24 validation

Validated on 2026-09-19 on Windows using Bun 1.4.2, Next.js 16.3.5, Docker Linux containers, PostgreSQL 17.10, and the Codex in-app browser. These results cover the verified web-account slice in [issue #24](https://github.com/Umami-Creative-GmbH/pr0/issues/24). Follow the [account deployment guide](accounts.md) to reproduce the setup.

## Automated results

| Check | Result |
| --- | --- |
| `bun run typecheck` | Six workspace typecheck tasks passed. |
| `bun run test` | 82 tests passed across the prototype, API client, and web packages; unchanged Turbo tasks reused their cache. |
| `bun run --cwd apps/web test:accounts` | Production Compose acceptance passed: 45 assertions, approximately 103 seconds. Its nested public HTTP suite also passed all seven tests. |
| Production Docker build | Passed, including the Next.js production build and bundled Bun operational commands. |
| Ultracite fix/check on changed files | Passed. Includes the repository's integrated React Doctor rules. |
| Repository-wide `bun run check` | Failed on existing formatting issues in 57 unchanged/untracked files and existing research-harness lint violations. Those files were left untouched. |
| Standalone React Doctor | Could not complete under Bun: `child.channel?.unref is not a function`. No Node fallback was introduced. |

The production image tested was `pr0-accounts-24`, manifest `sha256:6429aa37ab08babbd71fe6f1393332e17bc21e718ecf65008c9542dfba9119b0`.

The deployment suite creates a fresh, randomly named Compose project with disposable credentials and a local Mailpit sink. It applies all three migrations twice, checks default-closed registration and explicit first admission, verifies registration never grants access before email verification, then exercises sign-in, private-library ownership, cookie renewal, logout, and container recreation with the database volume retained. Account, session, and immutable instance identity survive recreation.

Negative checks cover expired verification links, expired sessions, unverified accounts, incorrect session provenance, foreign account IDs, forged origins/forwarded headers, extra input fields, disabled auth routes, compressed/oversized bodies, shared email throttling, duplicate signup responses, and invalid credentials. SMTP interruption queues work durably and delivery resumes without verifying the account automatically. HTTPS canonical-origin configuration produces Secure session cookies; this is a cookie configuration test, not an external TLS deployment test.

Review regressions additionally cover retained allowlist entries after switching to closed registration, equal failures for known/unknown addresses when the mail queue is full or encryption configuration is invalid, and global request admission while session queries are blocked. The closed-registration regression was observed failing against the earlier image before the correction. Controlled database changes set up clock, provenance, capacity, and lock fixtures; assertions use public HTTP responses.

## Browser acceptance

A separate disposable production Compose instance was initialized in closed mode with an explicitly admitted synthetic address. Using visible form controls and keyboard submission in the in-app browser:

1. Registered the synthetic account and observed generic verification guidance receiving focus.
2. Read the captured message in Mailpit and opened its verification link. The web page reported successful verification and required sign-in.
3. Signed in and observed the private empty library, account address, canonical origin, immutable instance ID, and “No pending work.” The success message received focus.
4. Recreated PostgreSQL, web, and mail containers while retaining the volume. Reloading the browser restored the signed-in library and the same instance ID, `f30e4a43-8e75-4811-8372-b01a5e330879`.
5. Activated Sign out with the keyboard and observed the sign-in form and focused “Signed out.” message.

The narrow browser viewport displayed the account and empty-library panels without horizontal clipping. Labels, heading structure, button names, and status focus were inspected through the accessibility tree. This is not a full screen-reader, zoom, or cross-browser accessibility certification.

## Standards

The independent standards review identified missing account-client cancellation coverage and duplicated email polling. Both were corrected and re-reviewed. No remaining actionable findings.

## Spec

The independent spec review identified enumeration through mail-admission failures, incomplete request-work coverage, and retained admissions bypassing closed mode. All three were corrected, covered by production regressions, and re-reviewed. No remaining actionable findings.

Final review totals: Standards 0; Spec 0. Broader MVP release gates such as disaster restore, native distribution, prompt synchronization, and cross-browser certification remain outside this slice.
