# Service operations validation — issue #60

Validated on 2026-09-21 on Windows x64 with Bun 1.4.2, PostgreSQL 17 disposable Docker fixtures, Microsoft Edge headless and the installed Rust/Windows C++ toolchain.

## Public boundaries

`bun run --cwd apps/web test:operations` passed 15 REST acceptance tests (88 assertions) against two independent Bun production processes sharing PostgreSQL. Checks cover shared failed-login/account/mutation budgets, IPv6 /64 grouping, spoofed ingress headers, shared auth/device bursts, mixed accepted/rejected batches and retry, registration pause/recovery, suspension/resume without data loss, queued search, waiting-poll limits, readiness, private metrics, 70%/80% storage alerts and the authenticated canary probe with missing monthly coverage. Its Edge test passed five assertions for visible throttling/suspension guidance, retained editable drafts and recovery without reload.

`bun run --cwd apps/web test:operations native` passed the real Rust HTTPS path: browser device approval, Windows Credential Manager persistence, restarted native service, authenticated refresh and independent sign-out. Two live native clients observed the committed revision; measured propagation in this run was 126 ms. Suspending the account produced the explicit typed suspension failure and preserved the downloaded library. The initial check exposed the old transport's generic 403 mapping; it passed after recognizing the shared suspension error.

The shared service-failure fixture is also consumed at the validated TypeScript client and Rust command seams. Rust checks retain downloaded and pending work after suspension or overload and across restart. Client checks reject malformed failures and cover cancellation/retry metadata.

Independent standards and specification reviews found missing-index false readiness, missing ordinary failed-login counters and missing readiness alerts. New public-boundary tests reproduced the first two before their fixes; they now pass, including exact single-counted login failures and the readiness alert after moving the derived index away. Readiness checks the current local file signature and index format. The native fixture's positional flags were replaced with named scenario options after the standards review.

## Repository checks

- `bun run test`: passed all eight Turbo tasks, including 41 API-client tests and seven web unit tests.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`: 67 passed, zero failed.
- Production web builds and TypeScript checks passed during the acceptance runs.
- Changed JavaScript/TypeScript files were formatted and checked with the repository's Bun/Ultracite configuration; the changed Rust source was formatted with rustfmt.

## Deployment evidence still required

These results establish behavior in a disposable local environment. They do not establish the 1,000-account production capacity envelope or 99.5% monthly production availability. Operators must configure trusted ingress, supply actual volume/verified backup observations, connect alert delivery, run the authenticated probe outside the deployment every minute and retain its evidence. Missing observations are reported as unavailable. No production deployment, disk expansion, backup verification or monthly availability claim was made by this implementation.
