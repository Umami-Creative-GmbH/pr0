# Issue #26 validation

Recorded 2026-09-20 on Windows with Bun 1.4.2, Next.js 16.3.5, Better Auth 1.7.5,
disposable PostgreSQL and Mailpit. No real provider credentials were supplied.

## Automated evidence

`bun run --cwd apps/web test:social` completed successfully. It builds the
production Next.js application and serves that build under Bun, with external
provider HTTP responses supplied by a test-only preload. All account state,
sessions, admission, pending proofs, and email jobs use the real PostgreSQL
implementation. Email is delivered by the real worker to Mailpit.

- Open registration: 9 tests, 74 assertions passed.
- Closed registration after server restart: 2 tests, 11 assertions passed.
- Allowlist after server restart: 1 test, 10 assertions passed.
- Both providers disabled: 1 test, 5 assertions passed, including verified
  email/password signup and library access.

Coverage includes provider availability, fixed callbacks and PKCE, Google RSA
signature/issuer/audience/nonce/expiry checks, denial, absent/stolen/forged state,
provider mixup, replay, direct-route bypass rejection, immutable returning
accounts, changed/missing provider email, existing-email collisions, one-hour
pending expiry, verification cookie binding, resend invalidation, concurrent
verification, social-only password recovery, shared password/OAuth signup
throttling with retry guidance, and registration rechecks after email verification.
The closed/allowlist cases preserve established account identity across restart
and direct both provider-email and collected-email collisions to recovery.

`bun run test` passed all 84 workspace tests (unchanged prototype tests used the
Turborepo cache). `bun run typecheck` passed all workspace typechecks. The
production build passed. Ultracite fix/check passed all 24 changed/new TypeScript,
TSX, and JSON files; `git diff --check` passed. A broader formatting check also
reported pre-existing formatting differences in unchanged files; those files were
not modified by this ticket.

## Browser evidence

The production app was checked through the Codex in-app browser:

1. Both enabled provider buttons appeared beside email/password and recovery.
2. Keyboard activation of GitHub opened its authorization/login URL with the
   configured local callback, state, scopes, and PKCE challenge. No real GitHub
   credentials were entered or consent granted.
3. A controlled callback for a provider without email opened the email collection
   page with a labeled required email input and keyboard-operable submit button.
4. Submitting a disposable address queued delivery, displayed the inbox/retry
   explanation, and moved focus to the live status message.
5. Opening the Mailpit-delivered link removed its fragment and presented explicit
   “Verify email and open library” confirmation.
6. Keyboard confirmation reached “Your library,” displayed the verified account
   and instance, and showed the independent browser session.

## Review

### Standards

Final independent review: 0 remaining findings. A duplicated provider-owner
lookup was extracted while retaining the two required ownership checks.

### Spec

Final independent review: 0 remaining findings. Review identified and resolved
shared signup throttling and collision guidance under closed/allowlist admission;
both are covered by the passing production matrix above.

## Limits

The standalone React Doctor 0.9.14 regression command failed under Bun on Windows
with `child.channel?.unref is not a function`; no standalone score is claimed.
The repository's integrated React Doctor lint rules passed on changed files.

Provider HTTP fixtures are not live Google/GitHub consent-screen evidence. Follow
the [operator validation procedure](../social-login.md#validation) with real
per-instance credentials before claiming that live-provider check. This ticket
does not claim native device login, explicit method linking, or an installed
Windows application journey.
