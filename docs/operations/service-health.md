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

The optional [example ingress](self-hosting.md#optional-example-ingress-behind-an-edge-proxy) in `infrastructure/ingress` applies these rules behind an edge proxy such as Coolify's Traefik. It trusts `X-Forwarded-For` only from `PR0_INGRESS_TRUSTED_PROXIES` and resolves it right to left. It overwrites both pr0 headers, rejects bodies above 4 MiB (413) and compressed bodies (415), allows 60 seconds for upstream reads and disables response buffering. It answers 404 on `/api/v1/operations/` unless the client is in `PR0_INGRESS_METRICS_ALLOW`, so keep the bearer secret _and_ list only the probe host there. Its access log records time, client address, method, path without query string, status, bytes, duration and upstream status, and never `Authorization`, cookies, bodies or query strings. Its error log is limited to process-level alerts, because nginx error entries embed the full request line.

Verify the example through the self-hosting fixture (Docker required):

```sh
docker build --target runtime -t pr0-self-host-62 .
docker build --target migration-runtime -t pr0-self-host-tools-62 .
bun run --cwd apps/web test:ingress
```

The test builds the ingress image and adds it to a disposable self-hosting project, with a stand-in edge proxy that appends the observed peer to any client-supplied `X-Forwarded-For` (a worse case than Traefik, which discards untrusted forwarded headers). Containers with fixed IPv4 and IPv6 addresses act as real clients, the probe and a peer outside the trusted network. It lowers `PR0_LIMIT_AUTH_MINUTE` to 10 for that project and checks the following. Forged pr0 and forwarded headers, even with the real ingress secret, stay in the sender's bucket. Separate IPv4 addresses and separate IPv6 /64s get separate buckets, while addresses within one /64 share a bucket. Oversized and compressed bodies are rejected before the application. The 25-second long poll completes. Metrics are refused for other addresses and for forged forwarding. The image runs as non-root and reports healthy. Its logs contain no query, credential or cookie values. `PR0_SELF_HOST_IMAGE`/`PR0_SELF_HOST_TOOLS_IMAGE` select other test tags.

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

These commands measure filesystem capacity, including WAL, indexes, retained receipts/history, journals and other overhead. Do not report the web container's root filesystem as a remote database disk. Coverage older than five minutes is missing and raises `storage_coverage_missing:<name>` (plus the aggregate `storage_coverage_missing`).

### Storage the application host cannot mount

Deletion ledger A and ledger B run on independent hosts, so the application host cannot sample their volumes. Each ledger host measures its own filesystem and pushes the result to the application host's operations tooling, which records it with:

```sh
bun run --cwd apps/web operations record-storage <database|search|ledger-a|ledger-b|backup> <total-bytes> <used-bytes>
```

This writes the same storage observation as `sample-storage`. The values must be non-negative decimal integers, total must be positive, and used cannot exceed total. Unknown names and invalid values exit nonzero without writing anything. The ledger hosts never receive application database credentials; they can only run this one command over SSH.

On the **application host**, install a wrapper that pins the storage name and accepts only two numbers, for example `/usr/local/bin/pr0-record-storage`:

```sh
#!/bin/sh
set -euf
name="$1"
# Word-split the pushed "<total> <used>" without globbing; record-storage validates both values.
set -- ${SSH_ORIGINAL_COMMAND:-}
[ "$#" -eq 2 ] || exit 64
cd /srv/pr0
exec bun run --cwd apps/web operations record-storage "$name" "$1" "$2"
```

Run it as the operations user that already holds the server-only database configuration. In Compose deployments, replace the last two lines with `exec docker compose run --rm -T operations record-storage "$name" "$1" "$2"` from the deployment directory. Give each ledger host its own dedicated key, restricted in that user's `~/.ssh/authorized_keys` to this command and its own storage name:

```text
restrict,command="/usr/local/bin/pr0-record-storage ledger-a",from="<ledger-a-address>" ssh-ed25519 AAAA... pr0-ledger-a-storage
restrict,command="/usr/local/bin/pr0-record-storage ledger-b",from="<ledger-b-address>" ssh-ed25519 AAAA... pr0-ledger-b-storage
```

`restrict` disables port, agent and X11 forwarding and terminals; the forced command ignores whatever the client asks to run, so a compromised ledger host can report only its own capacity.

On **each ledger host**, measure the filesystem that holds the ledger's PostgreSQL data with the same arithmetic as `sample-storage` (used = blocks minus blocks available to unprivileged users) and push it, for example `/usr/local/bin/pr0-push-storage`:

```sh
#!/bin/sh
set -eu
set -- $(stat -f -c '%b %a %S' /var/lib/postgresql)
total=$(($1 * $3))
used=$((($1 - $2) * $3))
exec ssh -i /etc/pr0/storage-key -o BatchMode=yes -o ConnectTimeout=10 \
  pr0-ops@app-host.example "$total $used"
```

Keep the private key readable only by the cron user, and pin the application host key in that user's `known_hosts`. Run the push **every minute** from cron, the same cadence as local sampling:

```text
* * * * * pr0-storage /usr/local/bin/pr0-push-storage
```

One or two missed pushes are tolerated; after five minutes without a successful push, `storage_coverage_missing:ledger-a` (or `ledger-b`) fires again. Investigate that alert as a broken host, key or network path rather than silencing it. The 70% and 80% `storage_expand:<name>` and `storage_critical:<name>` alerts apply to pushed measurements exactly as to sampled ones. `storage_expand:<name>` fires at 70%; arrange expansion immediately and complete it **before 80%**. At 80%, `storage_critical:<name>` requires urgent operator action. Preflight measured staging/scratch space before rebuilds, snapshots or restores. An alert is not an automatic volume expansion.

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

`availability burn-in <start-minute> <samples.jsonl>...` applies the same rules to the 7 × 1440-minute burn-in window across monthly files. The hosted probe host, its alert rules (ntfy, email and a dead-man's switch), the canary procedures and the deliberate-failure test are described in [External probe host and alerting](probe-host.md).

## Verification commands

```sh
bun run --cwd apps/web test:operations
bun run --cwd apps/web test:operations native
bun run typecheck
bun run test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

The operations fixture creates disposable PostgreSQL/ledger/SMTP containers, two real Bun production servers, public REST checks and a browser draft-retention check. The native mode uses real Rust HTTPS, browser device approval, Windows Credential Manager and restarted native services. Rust/Cargo and the Windows C++ toolchain must be on PATH. See [validation evidence](service-health-validation.md).
