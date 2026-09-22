# Docker Compose deployment and self-hosting

Status: deployment design for [issue 11](https://github.com/Umami-Creative-GmbH/pr0/issues/11), approved and then clarified by the user on 2026-09-19: provide a simple, portable Docker Compose setup and leave hosting to the operator. This clarification supersedes this document's earlier requirements to select a particular server, hosting provider, proxy, storage vendor, signing service, or named operations team before completing the design. Those are deployment choices, not unresolved application-design questions.

The account, persistence, recovery, and compatibility guarantees still come from [account access](https://github.com/Umami-Creative-GmbH/pr0/issues/5#issuecomment-5742474484), the [operating envelope](https://github.com/Umami-Creative-GmbH/pr0/issues/8#issuecomment-5742705995), and the [persistence/API contract](https://github.com/Umami-Creative-GmbH/pr0/blob/095aed75970e37fbff9d7fcd72d87ac9e0aa1589/docs/specs/persistence-sync-contract.md). Their implementation and release tests are separate from producing a runnable container for the current application.

## Run the current application

The account slice in issue #24 now consumes PostgreSQL and a durable verification-mail worker. Follow [the account deployment guide](../operations/accounts.md) for runtime secrets, SMTP, explicit Bun migrations, local first-account admission, readiness, and repeatable container tests. Self-hosted registration defaults to closed and verification remains mandatory. The named PostgreSQL volume preserves account/session data and immutable instance identity across restart and recreation.

The earlier starter-container evidence below is historical. It does not replace the account slice's validation report or establish the remaining full-MVP release guarantees. The normative deployment requirements in the following sections remain in effect as their consuming features arrive.

## Portable deployment boundary

The application provides container build inputs, Compose service wiring, documented configuration, health checks, data-volume declarations when needed, and application migration/recovery commands. The operator chooses the machine, hosting company, domain, TLS endpoint, SMTP provider, backup destination, resource allocation, and monitoring system. A personal installation does not need a company operations team or any particular commercial vendor.

Use any suitable HTTPS reverse proxy or hosting ingress for an internet-facing instance. It can run on the host or in a separate container attached to the Compose network, targeting `web:3000`. No proxy is mandatory in the base Compose file and no certificate/DNS management is imposed. The application uses one configurable canonical origin for web and API, with no assumed public hostname. Local evaluation uses HTTP; production authentication and desktop connections require trusted HTTPS.

The agreed 2-vCPU/4-GiB/64-GiB benchmark is a full-workload validation fixture, not a minimum installation size or a server purchase requirement. Operators size their host for their actual data and concurrency. Do not hard-code that allocation into Compose or require a specific provider, region, host inventory, or fixed per-container memory ceiling. Document measured resource use, allow standard Compose overrides, and retain bounded application work independently of host size.

## Services and persistent data as features arrive

| Component | Deployment contract |
| --- | --- |
| Web/API | Next.js REST/UI under Bun; no Node.js fallback; one application replica initially |
| PostgreSQL | Canonical accounts, library and synchronization data in a named persistent volume; private network, no public database port |
| Search | Bun workers with persistent rebuildable SQLite projections; maximum two workers initially, bounded queues/caches, no public port |
| Migrations | Explicit one-shot Bun command from the matching application image; one coordinator |
| Backups | Documented backup/restore commands; scheduling and off-server storage integration chosen by the operator |
| Proxy/alerts | Operator-managed integrations; optional examples must not make a vendor or dashboard mandatory |

Add PostgreSQL and search services only with their consuming features. No Redis is required by the selected architecture. Preserve application-data volumes across restart, rebuild, upgrade, and ordinary `docker compose down`; document that removing volumes destroys stored data. Keep credentials outside images and source control, read only by the server/services needing them. Support mounted secret files for production credentials. Normal configuration can use environment variables; never expose server secrets through browser or desktop build variables.

Keep instance identity, deletion-verification trust material, and recovery keys persistent and recoverable. Restarting or replacing a container must not generate a new logical instance. Database and worker readiness must distinguish process liveness from usable schema, deletion-replay completion, and prepared search. Automatic container startup ordering alone does not establish readiness.

PostgreSQL remains authoritative. Search workers transactionally apply changes and their revision marker, reopen persisted SQLite files on restart, and catch up from the canonical log. Search waits for the required revision or reports `search_preparing` with retry guidance. Corrupt/incompatible indexes and expired cursors trigger a staged per-library rebuild with measured scratch-space preflight and atomic activation. Never discard canonical data to repair an index or silently present stale/truncated results as current. Bound aggregate search cache to 512 MiB initially; stage one rebuild at a time and tune against measured capacity.

## HTTPS, proxy trust, and request admission

Validate canonical origins and build authentication/email links from configuration, not arbitrary Host headers. Protect browser cookies with Secure/HttpOnly settings and CSRF/origin checks. Desktop uses independent sessions over native HTTPS; CORS is not authentication. A reverse proxy must accommodate the 25-second long poll, reject excessive bodies, and preserve forwarding semantics without buffering indefinitely.

Accept a canonical client IP only from explicitly trusted ingress peers. At that boundary discard/rewrite untrusted forwarded headers, or validate a known proxy chain from right to left. Otherwise use the socket address. Do not blindly trust all private networks or the first `X-Forwarded-For` entry. The operator configures the trusted topology; tests must demonstrate spoofed headers cannot evade rate limits.

Initial configurable limits, shared across processes and enforced consistently, are:

| Boundary | Default |
| --- | --- |
| Signup attempts | 5/hour/IP bucket |
| Verification, recovery, email-change verification, and fresh-authentication emails | Shared 3/hour/destination; 20/hour/IP bucket |
| Failed logins | 10/15 minutes/account-and-IP pair; 50/15 minutes/IP bucket across accounts |
| Anonymous auth/device requests | 60/minute/IP bucket, burst 10; legitimate device polling honors the advertised interval |
| Authenticated API | 120 requests/minute/account |
| Mutation work | 1,200 operations/minute/account, burst 200; maximum 100 operations and 4 MiB decoded JSON per request |
| Active request work | 16 server-wide, four/account; at most 64 queued for five seconds |
| Waiting long polls | 100 server-wide, four/account; waiting does not occupy database transactions or active-work slots |
| Search work | Two workers, one active query/account; at most 32 queued for two seconds; cancel obsolete typeahead |

Use IPv4 /32 or IPv6 /64 IP buckets after trusted-proxy handling. Tune broader IP limits for shared NAT without removing per-account controls. Bound decompressed input before allocating/normalizing it; reject unsupported request compression. Return explicit retry delays for throttling/overload and preserve pending client work. A queue limit must never change matching semantics by silently truncating search candidates. Validate normal traffic and offline catch-up as well as abuse rejection. CAPTCHA remains optional if actual abuse warrants it.

## Authentication and email configuration

The public service offers Google, GitHub, and email/password. Self-hosters may omit both social providers and use verified email/password with an ordinary transactional SMTP service. No particular provider is required. Disabled providers must disappear from the UI and reject direct attempts. Closed/open/allowlist registration modes apply to every new-account path, including OAuth, while allowing existing-account login and recovery. Default self-hosted registration to closed with a documented local operator command for first-account admission; no shared bootstrap password or verification bypass.

Document SMTP host/port/TLS policy, credentials, verified sender, and delivery diagnostics. Production account access requires working email verification/recovery, including social-only accounts. Preserve explicit login-method linking without automatic merging by email. Sensitive actions use the canonical browser-bound reauthentication flow: an eight-digit code, five-minute expiry, three attempts, and ten-minute fresh-authentication proof. Renewal, device approval, or delivery of a message is not that proof. Resend invalidates the prior challenge; transport retries do not extend the replacement challenge's lifetime.

Enqueue mail durably, protect token-bearing payloads, use bounded retries within token expiry, and surface delivery failures without enumerating accounts. Failed verification leaves the account unverified; failed password-recovery delivery leaves credentials unchanged; failed new-address verification leaves the old email active. A completed email change queues notification to the old address, with bounded retries and operator-visible terminal failure. SMTP acceptance is not confirmed inbox delivery. Known delivery outages may pause registration but must not bypass verification or freshness. Preserve server-owned browser/device provenance and guard direct authentication-library routes as well as application wrappers.

For each enabled social provider, self-hosters register their own app and credentials with the canonical instance origin. With `/api/auth` as the prefix, callbacks are exactly `https://<instance-host>/api/auth/callback/google` and `https://<instance-host>/api/auth/callback/github`. Separate development/production applications as appropriate and document consent/email permissions. Actual provider login and email flows require integration tests before release. These instructions do not require selecting the public service's real hostname or provider account to complete #11.

## Backups, deletions, and restore

The application must provide a provider-neutral backup/restore procedure. The accepted public-service objectives remain encrypted off-server backups, at most one hour of ordinary data loss, restoration within 24 hours, and ordinary backup retention no longer than 30 days. A personal operator chooses their storage and schedule; meeting those objectives requires verified recoverable copies, not simply a running cron job. Daily PostgreSQL base backups with continuous WAL archival are one suitable implementation, not a mandated hosting product. Include volume/configuration/key recovery and retention of all object versions; alert if the newest recoverable checkpoint exceeds one hour or retention cleanup fails.

Completed account deletions must never be revived by a restore. Keep minimal signed deletion evidence and key-rotation continuity independently durable from ordinary database backups, with zero loss of acknowledged deletions and indefinite verification for offline devices. Store no prompt text, email, or profile in this ledger. A local database table copied by hourly backups cannot satisfy that guarantee. The storage interface must support durable acknowledged writes, complete replay, and protection against accidental history removal; operators may use any backend that meets and passes these requirements. No cloud vendor or bucket/region is selected by this specification.

The idempotent coordinator denies account operations, persists independent deletion intent, purges live data/sessions/indexes/caches, then persists the signed completion receipt before reporting success. Storage failure leaves a visible pending/retry state. Recovery finishes committed intent even if the session is gone. Pending intent, missing receipt, generic unauthorized response, or suspension cannot authorize deletion of a desktop's retained work. Verification material and signed key continuity survive container and credential rotation.

The restore procedure must:

1. Close public admission and fence the previous deployment and background writers.
2. Recover the intended application/database versions, immutable instance identity, credentials/keys, and the latest complete independent deletion ledger. Missing or uncertain evidence keeps the restore barrier closed.
3. Restore a verified ordinary backup/checkpoint; invalidate restored sessions, unused account-action tokens, device approvals, and fresh-authentication proofs so revoked credentials cannot become valid again. Remove obsolete token-bearing mail jobs.
4. Replay every deletion intent/completion and finish pending purges before serving users; independently verify that deleted data and sessions are absent.
5. Establish a new recovery epoch, invalidate old cursors/snapshots, rebuild/catch up derived search, and check service health. Returning desktops preserve pending work and authenticate before upload; they must not automatically re-upload every formerly acknowledged row.
6. Reestablish backups/monitoring, open admission only after the barrier passes, and record actual loss/recovery time. Rehearse before public release and quarterly thereafter, including unavailable/incomplete evidence, key rotation, and a deletion newer than the database backup.

These are application data guarantees, not a requirement that every host use identical backup infrastructure. A simple Compose start does not establish that recovery objectives have been validated.

## Upgrades and operational visibility

Ship versioned images/build inputs and release notes identifying schema, protocol, normalization, configuration changes, and tested platforms. Use one Bun migration coordinator with an exclusive database lock, recorded migrations, and explicit checkpoints. Preflight disk/scratch requirements and a fresh recoverable backup. Drain admission where necessary, migrate, replace containers while preserving volumes, check health, and reopen. If migration fails, preserve data and stay closed until repaired; roll back only to a binary compatible with the resulting schema, otherwise use the deletion-safe restore procedure.

Support current desktop releases and those shipped in the preceding 90 days using compatible schema/protocol/normalization behavior. An incompatible client retains offline data and pending edits and receives an actionable upgrade requirement before uploading. A newer desktop connecting to an older self-hosted server must negotiate compatibility safely. Desktop installation updates preserve local libraries and outboxes.

Expose useful health, structured redacted logs, and private metrics for request/operation errors, queue age, worker load, index revision lag, physical/logical storage growth, email failures, and backup/restore/deletion-ledger health. Never log prompt content or credentials. Alert at 70% disk use and expand before 80%; allow operators to connect their own alerting tools. Monitor archive/WAL growth and preflight space before snapshots/rebuilds. Report `search_preparing` honestly during recovery. Do not prescribe a monitoring vendor or put a mandatory monitoring stack in the base Compose file.

The public service retains the 99.5% monthly availability target, including maintenance. Measure it externally using a bounded synthetic authenticated library operation and search at a documented interval; missing coverage counts as unavailable. The public operator owns incident response, abuse reports, upgrades, and recovery; self-hosters own their own installations. Named contacts, budgets, domains, and provider accounts are operator setup details, not application-design acceptance criteria.

## Desktop distribution and self-hoster onboarding

Umami owns official Windows installer signing, direct downloads, and signed, user-approved updates. The hosting specification does not mandate a signing vendor or download host. Updater signatures are required. Windows Authenticode publisher signing is optional for the initial zero-cost release path; installers without it may show Windows publisher/reputation warnings. An instance cannot redirect the official client's executable-update trust to its own binaries. Custom desktop forks own their signing and distribution.

The planned official client lets users select a compatible HTTPS instance before login, then performs browser-based device approval. Accounts/libraries remain independent between instances. Switching follows sign-out/pending-work safeguards and never merges libraries. The current desktop scaffold still embeds an HTTPS API origin at build time; runtime instance selection remains part of implementing the agreed account-access design.

The self-hoster path is clone/download, optionally configure Compose, and run the startup command. As account/persistence features arrive, extend this with a secret-free configuration example, local initialization/migration commands, named data volumes, SMTP configuration, optional OAuth registration, HTTPS guidance, backups, and upgrades. Each guide must describe application requirements without requiring a specific hosting provider, region, proxy, domain, or staffing model.

## Acceptance and remaining implementation

The current Docker change must build with the locked dependencies, start under Bun as a non-root user, pass its health check, serve the UI/API/docs/static assets, apply runtime port/origin settings, and stop/recreate successfully. Report which architecture was tested; an image manifest advertising ARM64 is not itself an ARM64 application test.

Verification on 2026-09-19: the Linux AMD64 image built and passed the Compose health check, UI/API/OpenAPI/Swagger and static-asset checks, non-root Bun execution, runtime CORS allow/deny checks, and stop/recreate with changed port/origin without rebuilding. Typechecking, the existing 14 tests (partly served from Turbo cache), scoped lint/format checks, and both review axes passed. An ARM64 cross-build was attempted but stopped at `/bin/sh` with `exec format error`; the local Docker builder advertises only AMD64 and has no ARM64 execution support. ARM64 application execution remains unverified. Test containers and networks were removed after validation.

Future feature releases retain the canonical capacity, performance, accessibility, isolation, interrupted-sync, upgrade, and deletion-safe restore gates. The full workload is 1,000 accounts, 10 GiB aggregate text, 20 active users, 10 requests/second for 30 minutes and a 30/second burst, including a 10,000-prompt/100-MiB library. Keep the issue 8 latency budgets, 120-second initial download, and 60-second 1,000-edit/10-MiB catch-up target. Resource use and supported architectures must be measured; small self-hosted instances do not inherit a full-workload performance claim.

No choice of actual server, provider account, hostname, backup vendor, signing vendor, or named operator is required to close the deployment-design discussion. The user's hosting clarification resolves that scope. Feature implementation and its release evidence remain outstanding; the runnable starter container does not claim production authentication, synchronization, data recovery, or installer distribution is complete.
