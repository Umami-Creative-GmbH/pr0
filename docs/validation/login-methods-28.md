# Login-method management validation — #28

Validated on 2026-09-20 against starting commit `f8bb094ccaef6bbe2e005de99880c76732f0ee8f`, using Windows, Bun 1.4.2, Next.js 16.3.5, Better Auth 1.7.5, PostgreSQL 17 and Chromium 153.

## Automated checks

- `bun run typecheck`: all six workspace tasks passed.
- `bun run test`: 86 tests passed (66 prototype, 13 API client, seven web).
- `bun run --cwd apps/web test:login-methods`: 12 integration tests and two policy tests passed against isolated production servers, PostgreSQL and SMTP fixtures. A final production rebuild reran the 12 integration tests with 71 assertions, including uncached responses and referrer policy.
- `bun run --cwd apps/web test:email-change`: 14 email-change, one SMTP-outage, five recovery and seven account tests passed.
- `bun run --cwd apps/web test:social`: nine social-authentication tests and four policy tests passed.
- Production builds and database migrations passed in the acceptance runners. Login methods reuse schema version 6.

The method tests exercise explicit Google/GitHub linking with different and matching emails, original account/library ownership, competing ownership, callback cancellation/failure/replay, expired state/proofs, switched accounts/browsers, revoked and device sessions, changed email versions, malformed and cross-origin requests, direct-route bypass attempts, password removal and subsequent provider sign-in, concurrent removals, and duplicate-provider guidance. Policy restarts cover closed registration and disabled providers when calculating the last usable method.

Red-to-green checks first observed missing method endpoints and missing API-client operations, then passed through the public REST seam. Time and provenance fixtures manipulate the isolated database; assertions observe public responses. Outbound OAuth exchange uses the existing controlled provider fixture.

## Browser checks

Used the production server with a disposable local account and controlled GitHub callback identity. Verified:

- Sign-in and password-based fresh authentication; management controls are unavailable before proof.
- Refusal to remove the last usable method, with visible guidance.
- Explicit GitHub authorization navigation; cancellation leaves the account unchanged.
- Linking a different-email identity retains the original account email and instance.
- Removal cancellation, successful removal while a password remains, and relinking.
- Sign-out and returning GitHub sign-in reach the original account/library without granting fresh authentication.
- Keyboard activation of Remove focuses Confirm removal; Tab reaches Cancel; cancellation focuses its live status and retains the method.
- Account-security layout and visible status messages render correctly.

No real provider credentials were used. These checks validate the application flow with controlled OAuth responses; they do not certify a deployed Google/GitHub application configuration. No desktop/native behavior changed.

## Review and tooling limits

Independent Standards and Spec reviews found no remaining actionable issues. Review corrections covered shared callback-result validation and actionable duplicate-provider guidance, descriptive test names, and removal-confirmation focus.

Changed-file Ultracite formatting/lint and `git diff --check` passed. Whole-repository formatting checks encounter existing unrelated research-document formatting issues; those files are outside this change. Standalone React Doctor failed with the existing Bun/Windows `child.channel?.unref is not a function` error, so no standalone score is claimed. Integrated React lint checks and production type/build checks passed.

The acceptance runners clean up their disposable services. See [operation notes](../operations/login-methods.md) for the API and repeatable login-method test command.
