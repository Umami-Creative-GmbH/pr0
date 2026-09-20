# Issue 56 — account deletion validation

Validated on 2026-09-20 in the Windows worktree on branch `ai/account-deletion-56`, using Bun 1.4.2, Next.js 16.3.5, PostgreSQL 17 containers and headless installed Chrome through Playwright. The disposable Compose project was `pr0-deletion-56`; its containers and volumes were removed after each run.

## Observed results

| Boundary | Result |
| --- | --- |
| Public deletion REST integration | 6 tests passed: browser/fresh-auth/confirmation/identity guards; concurrent mutations; same-email recreation; exact account purge; ledger failure and automatic recovery; signature interoperability and rotation |
| Process restart at durable boundaries | 7 scenarios passed: local barrier, intent A, intent B, canonical purge, completion A, completion B and local-work cleanup |
| Ordinary backup restoration | Both phases passed: restored account remained inaccessible with one unavailable ledger; complete replay then purged it again and repaired the incomplete ledger's receipt from the surviving copy |
| Served browser | 3 tests passed: keyboard confirmation/cancel/focus and verified cleanup; reload after an interrupted verification response recovered without a session; a delayed old receipt preserved another account's unsaved draft |
| Existing REST regressions | Email change 14, login methods 12, prompts 6, prompt deletion 8, organization cleanup 9 and accounts 7 passed |
| Shared client and repository suite | `bun run test` passed, including 27 API-client tests and 7 web tests; unchanged prototype tests passed through the workspace cache |
| Types and formatting | `bun run typecheck`, Ultracite on every changed supported file, and `git diff --check` passed |

The exact-purge integration assertion inspects a live PostgreSQL dump and account-specific SQLite artifacts, including operational mail and verification data, while retaining another account's data. Independent receipt verification uses both WebCrypto and the crypto signature API under Bun. The restart fixture terminates the owned application process after each controlled storage failure, removes the injected failure, and checks public results after startup.

The restore fixture takes real `pg_dump` snapshots before deletion, acknowledges a signed deletion, stops the application/mail worker, and restores the old ordinary database plus an old copy of ledger B. With B unreachable, readiness, library access and receipt lookup return 503 rather than unsigned absence or restored account access. On restart with both stores available, the restored account disappears, its old session returns 401, and both stores contain the identical verifiable receipt. This is a logical recovery rehearsal on disposable local containers, not evidence that production storage uses independent physical failure domains.

## Review and corrections

The required separate standards and specification reviews ran against the implementation. Standards review found no mandatory violations; it suggested optional consolidation of mail decoding and search-path helpers. Specification review identified browser recovery state lost on reload and cleanup of the wrong active partition after a delayed receipt. Both were corrected. Follow-up review identified additional organization and login-method query-key shapes; those are now included in identity-scoped cleanup.

The browser reload test first reproduced the missing recovery UI. Its final fixture waits for the actual verification-request boundary before reloading, so it cannot accidentally cancel submission before the server receives it. The account-switch fixture uses a browser foreground event and confirms the public library response belongs to the next account before creating its unsaved draft.

An initial session-renewal regression discovered by the wider suite was corrected: renewal checks the deletion barrier without reapplying issuance-only authentication-version constraints. The complete login-method regression suite passed afterward.

## Reproduction and limits

Run `bun run --cwd apps/web test:account-deletion` for the full integration, restart, restore, browser and regression sequence. For focused work, run the same runner with `--browser-only` or `--restore-only`. Public disposable credentials and dedicated ports are in `apps/web/tests/account-deletion.env`.

The standalone React Doctor command could not finish on Bun/Windows because its dependency calls `child.channel?.unref`, which is unavailable in that runtime. Integrated React Doctor lint rules passed through Ultracite. No Node.js fallback was introduced.

Deployment still requires the two independently durable PostgreSQL hosts, runtime grants, shared search volume and retention procedures described in [account deletion operations](../operations/account-deletion.md). Actual host-loss durability and backup-retention evidence belongs to the deployed infrastructure. No native Tauri command or permission was added by this browser-only slice.

## Integration with current main

Before publication, main commit `e3bcacf` was integrated. Its existing prompt-use migration remains version 014; the unpublished account-deletion migration is version 015. Both contract exports and the browser copy-eligibility changes were preserved. Typechecking and the repository test suite passed on the combined tree (28 API-client tests), and the full deletion runner was repeated for merge validation.

Repository-wide `bun run check` reports formatting issues in seven unchanged files and lint errors in the existing search-parity research scripts. The same failures occur in [main's CI run 35528918138](https://github.com/Umami-Creative-GmbH/pr0/actions/runs/35528918138), before this branch. Changed-file checks pass; the repository-wide check is not reported as passing.
