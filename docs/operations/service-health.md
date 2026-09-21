# Service admission and operational health

Issue #60 extends the production account, library and synchronization services. Apply migration 019 using `bun run --cwd apps/web accounts migrate` before starting this version. Keep the database and both independent deletion stores persistent. Use identical configuration and secrets on every web process. Multiple web processes must share the same search filesystem mounted at the same absolute `PR0_SEARCH_DIRECTORY` path: projection checkpoints describe that shared storage, not independent replica caches. No Redis or monitoring vendor is required.

## Operator controls

Run these commands inside the trusted application environment with its server-only database credentials:

```sh
bun run --cwd apps/web accounts pause-registration
bun run --cwd apps/web accounts resume-registration
bun run --cwd apps/web accounts suspend <immutable-account-uuid>
bun run --cwd apps/web accounts resume <immutable-account-uuid>
```

Registration pause is stored in PostgreSQL and checked on every new-account path, including OAuth account creation. Resume restores the configured closed/open/allowlist policy. Existing-account login and password recovery remain available. Suspension denies library access and uploads, including existing sessions and waiting polls. It leaves account data, sessions, receipts and local work intact. Resuming permits the same account to continue. A suspension response is never deletion evidence. Use the separate deletion coordinator for an explicit account deletion.

## Admission defaults

PostgreSQL shares counters, active request leases, waiting-poll reservations and search admission across processes. Counter keys are HMACs; they do not store email or IP text. Fixed windows enforce both the minute/hour allowance and the short burst window. All limits below are per instance.

| Environment suffix after `PR0_LIMIT_` | Default | Boundary |
| --- | --: | --- |
| SIGNUP_HOUR | 5 | Signup attempts/hour/IP bucket |
| EMAIL_DESTINATION | 3 | All verification/recovery/fresh-auth/email-change mail/hour/destination |
| EMAIL_IP | 20 | Those emails/hour/IP bucket |
| LOGIN_PAIR | 10 | Failed logins/15 minutes/account-and-IP; successful reservations refunded |
| LOGIN_IP | 50 | Failed logins/15 minutes/IP across accounts |
| AUTH_MINUTE / AUTH_BURST | 60 / 10 | Shared anonymous auth/device requests per minute / ten seconds |
| API_MINUTE | 120 | Authenticated requests/minute/account |
| MUTATION_MINUTE / MUTATION_BURST | 1200 / 200 | Mutation operations/minute / ten seconds/account |
| REQUEST_ACTIVE / REQUEST_ACCOUNT | 16 / 4 | Active request work globally / per account |
| REQUEST_QUEUE / REQUEST_QUEUE_MS | 64 / 5000 | Queued requests / maximum waiting time |
| POLL_TOTAL / POLL_ACCOUNT | 100 / 4 | Waiting long polls globally / per account |
| SEARCH_QUEUE / SEARCH_QUEUE_MS | 32 / 2000 | Queued searches / maximum waiting time |

Search uses two global advisory-lock slots and one active query/account. Request bodies retain the protocol maximum of 100 operations and 4 MiB of uncompressed JSON. Unsupported compression is rejected. Search queues never reduce matching candidates. Obsolete requests cancel their queued/worker work. A cold projection may continue preparing after a retry response while retaining its search slot. Waiting long polls hold no transaction or active request slot; each committed-page read acquires a short-lived work slot.

Tune positive integer limits only after measuring ordinary shared-NAT traffic and offline catch-up; deploy the same values to every process. Preserve mandatory body/operation bounds and the two-worker initial envelope. Error responses include retry delays, and mixed batches contain explicit per-operation accepted/rejected results. Clients retain rejected work and retry it without inventing acknowledgement.

## Trusted ingress

Next.js Request does not expose its peer socket. Production ingress must therefore supply the authenticated boundary already used by account admission:

- Keep the backend private to the ingress. Set `PR0_INGRESS_SECRET` (or `_FILE`) to a random shared secret.
- The ingress **overwrites**, rather than appends or preserves, `X-Pr0-Ingress-Secret` and `X-Pr0-Client-IP`. Derive the latter from its socket peer or a separately configured trusted proxy chain inspected right to left.
- Discard incoming versions of these headers. Never derive the value from an untrusted first `X-Forwarded-For` entry or trust every private network.
- Canonical buckets are IPv4 /32 and IPv6 /64. Missing/invalid ingress credentials or addresses use one conservative `untrusted` bucket; forwarded headers cannot create new buckets.

Configure HTTPS, decoded body limits and timeouts at the ingress too. Allow at least 35 seconds for the 25-second long poll. Never log authorization, cookies, bodies, email links or query strings at the proxy.

## Readiness, metrics and alerts

`GET /api/v1/health` reports process liveness. `GET /api/v1/ready` separately reports usable schema, deletion replay/ledger access, mail heartbeat and known search projection readiness. Projection checkpoints must match the current local file identity, modification time, size and index format, as well as the database epoch/revision. Missing, replaced or stale projections report `search_preparing`, HTTP 503 and a retry delay. Search catches up on demand; liveness alone is not availability. Failed readiness also produces the `readiness_unavailable` operational alert.

Set a separate `PR0_METRICS_SECRET` or `_FILE`. `GET /api/v1/operations/metrics` requires `Authorization: Bearer <metrics-secret>` and returns 404 when disabled or unauthorized. Keep this route on a private monitoring network at the ingress. The shared contract, OpenAPI and validated client describe its aggregate-only JSON. It includes request/search load and queue age, waiting polls, error counters, index revision lag, pending/failed mail, database/logical/history/WAL bytes, both ledger sizes/health, pending deletions, backup observations and volume pressure. Missing measurements are null/unavailable and generate alerts.

Application error logs use a fixed structured vocabulary and contain no prompt text, variable values, account identities, email, URLs or credentials. Metrics recording is bounded; a metrics persistence failure emits `metrics_unavailable`. Collect logs outside the application filesystem with bounded retention. Protect framework/proxy logs with the same redaction policy.

Sample **each actual storage filesystem** at least once a minute, on a host/container that can see that volume:

```sh
bun run --cwd apps/web operations sample-storage database /mounted/postgres-volume
bun run --cwd apps/web operations sample-storage search /mounted/search-volume
bun run --cwd apps/web operations sample-storage ledger-a /mounted/ledger-a-volume
bun run --cwd apps/web operations sample-storage ledger-b /mounted/ledger-b-volume
bun run --cwd apps/web operations sample-storage backup /mounted/backup-volume
```

These commands measure filesystem capacity, including WAL, indexes, retained receipts/history, journals and other overhead. Do not report the web container's root filesystem as a remote database disk. Coverage older than five minutes is missing. `storage_expand:<name>` fires at 70%; arrange expansion immediately and complete it **before 80%**. At 80%, `storage_critical:<name>` requires urgent operator action. Preflight measured staging/scratch space before rebuilds, snapshots or restores. An alert is not an automatic volume expansion.

After the backup system has **verified** an independently recoverable checkpoint and checked every ordinary object version against the 30-day retention policy, report its checkpoint:

The built-in [encrypted backup command](backup-restore.md) performs a scratch PostgreSQL restore and retention cleanup before recording this observation automatically. Manual reporting below is for another verified backup implementation, not a substitute for those checks.

```sh
bun run --cwd apps/web operations record-backup 2026-09-21T10:00:00.000Z retention-ok
bun run --cwd apps/web operations metrics
```

Use `retention-failed` when cleanup fails. Observations/checkpoints older than one hour are unavailable. Recording a timestamp does not create or verify a backup; the backup verifier owns that evidence. The metrics command exits nonzero when alerts exist, so operators can connect any alerting system. Follow [deletion-safe recovery](account-deletion.md) and retain restore rehearsal evidence independently.

## External availability probe

Run the probe once per UTC minute from a host **outside the deployment**. Provision a dedicated verified canary account containing one prompt titled `pr0-availability-canary`. Save its browser session cookie in a permission-restricted file; keep the account and credential out of ordinary user libraries. Configure `PR0_PROBE_ORIGIN`, `PR0_PROBE_COOKIE_FILE` and `PR0_PROBE_PROMPT_ID` on that external host.

```sh
bun run --cwd apps/web availability probe /evidence/2026-09.jsonl
bun run --cwd apps/web availability report /evidence/2026-09.jsonl 2026-09
```

Each 15-second bounded sample validates the authenticated library and a search that must find the exact canary in that account/instance. Redirects fail. The output contains only time, duration and availability, and the command exits nonzero on failure. Expired credentials, search preparation, maintenance, timeouts and an incorrect canary count unavailable. Renew the canary session before expiry; never discard failed samples.

Reports divide successful minutes by all elapsed UTC minutes in the month (including the current partial minute), or all minutes for a finished month. Missing/malformed observations count unavailable; a failed duplicate makes that minute unavailable. Rotate evidence monthly. The target is 99.5%, including maintenance. An application integration test is not a production availability measurement; preserve the actual external evidence and reports.

## Verification commands

```sh
bun run --cwd apps/web test:operations
bun run --cwd apps/web test:operations native
bun run typecheck
bun run test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

The operations fixture creates disposable PostgreSQL/ledger/SMTP containers, two real Bun production servers, public REST checks and a browser draft-retention check. The native mode uses real Rust HTTPS, browser device approval, Windows Credential Manager and restarted native services. Rust/Cargo and the Windows C++ toolchain must be on PATH. See [validation evidence](service-health-validation.md).
