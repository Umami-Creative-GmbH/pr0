# Docker Compose deployment and self-hosting

Status: specification for [issue 11](https://github.com/Umami-Creative-GmbH/pr0/issues/11), following the user's instruction on 2026-09-19 to use the recommendations. This records the recommended deployment baseline and operator checklist. Actual infrastructure allocation, provider accounts, signing credentials, and operational contacts have not been supplied or inspected. The checklist distinguishes these outstanding inputs from design choices and from implementation/release tests. No infrastructure has been provisioned and no runnable deployment is claimed.

## Authority and scope

The canonical inputs are [account access](https://github.com/Umami-Creative-GmbH/pr0/issues/5#issuecomment-5742474484), the [operating envelope](https://github.com/Umami-Creative-GmbH/pr0/issues/8#issuecomment-5742705995), and the [persistence/API contract](https://github.com/Umami-Creative-GmbH/pr0/blob/095aed75970e37fbff9d7fcd72d87ac9e0aa1589/docs/specs/persistence-sync-contract.md). Their account boundaries, quotas, durability, compatibility, and release requirements remain authoritative. The [final architecture resolution](https://github.com/Umami-Creative-GmbH/pr0/issues/10#issuecomment-5743817032) replaces the initial 40 GiB benchmark disk with 64 GiB.

One instance owns independent accounts and libraries. Self-hosting changes the operator, origin, and external integrations; it does not create federation, cross-instance identity, or a weaker synchronization/deletion contract. No new glossary term or architecture reversal is introduced.

This is an implementation handoff for a supported single-host Docker Compose deployment. Kubernetes, clustered application replicas, managed database alternatives, and production deployment are outside this ticket. Concrete numeric limits below are initial operational defaults to validate, not benchmark results.

## Supported target and resource allocation

Use a maintained Linux x86-64 host, Docker Engine with the Compose v2 plugin, and local SSD-backed filesystems for PostgreSQL and SQLite. Windows Docker Desktop and ARM64 hosts are not first-release production support targets. Provide exact tested host OS, Docker/Compose versions, image digests, and CPU capabilities in each release manifest; installation must check them. Bun publishes several container variants, but this deployment selects the Debian/glibc variant and Linux amd64 only. See [Bun installation and container documentation](https://bun.sh/docs/installation).

Use Bun 1.4.2 and PostgreSQL 17.10 as the architecture's initial compatibility baseline, subject to security review and rerunning the pinned compatibility tests before release. Build the application from the workspace lockfile into a versioned image using the pinned Bun Debian image digest. Every JavaScript/TypeScript CLI, server, worker, and migration runs under Bun with explicit `bun --bun` entry points. PostgreSQL, Caddy, and native backup utilities retain their native runtimes. No Node.js production fallback or Edge target is supported. Do not use mutable `latest` tags or silently upgrade a PostgreSQL major version.

Reserve 2 vCPU, 4 GiB RAM, and 64 GiB usable SSD space for the initial full-workload validation. Shared hosts must provide that allocation after unrelated services, OS storage, and host overhead are considered. This is a requested allocation, not an inspected server or guaranteed capacity. Smaller self-hosted libraries may use smaller disks after measuring usage; the full benchmark claim requires the full fixture and reserve.

Initial container memory ceilings are web 1,024 MiB, search worker service 1,024 MiB, PostgreSQL 1,024 MiB, Caddy 128 MiB, and the backup job 256 MiB, leaving 640 MiB for the host and incidental overhead. Limit application/search/PostgreSQL containers to at most two CPUs each, Caddy and background backup jobs to 0.5 CPU each; these ceilings share the same two host CPUs and do not reserve additive capacity. Throttle backup/rebuild work during contention. Migration jobs run with application admission closed and a 512 MiB ceiling. Measure OOM behavior and peak resident memory under the release workload before accepting these values.

PostgreSQL starts with 256 MiB shared buffers, 4 MiB work memory, and 40 connections maximum. Bound normal application pools to 16 connections total, workers to four, and backup/migration/operations to eight, leaving administrative reserve. These are tuning defaults, not a per-connection memory guarantee. A long poll never holds a database transaction or reserved connection while waiting.

## Compose services, volumes, and startup

| Service | Role and persistence | Exposure |
| --- | --- | --- |
| `proxy` | Caddy; persistent certificate/configuration state | Host ports 80 and 443 only |
| `web` | Next.js REST and UI under Bun; one replica; durable application state in PostgreSQL | Private ingress network, port 3000 |
| `search` | One Bun service owning at most two search workers; persistent SQLite projections, bounded scratch and cache | Authenticated internal operations only; no host port |
| `postgres` | Canonical PostgreSQL, named data volume and bounded WAL staging | Private backend network only |
| `migrate` | Same application release image; explicit one-shot Bun migration coordinator | No host port; maintenance profile |
| `backup` | Pinned native PostgreSQL backup/archive utilities, scheduled by an operator-managed timer | Outbound off-server storage access; no host port |

No Redis is required. Persistent rate-limit state, mail jobs, and coordination records use PostgreSQL. The web service must not acquire direct writable access to worker-owned SQLite files. The internal worker interface binds authenticated account/instance/revision requests, with bounded payloads and cancellation; it is not a general SQL or filesystem endpoint.

Use named volumes for PostgreSQL, the rebuildable search projection, capped snapshot/rebuild staging, and Caddy certificate state. Retain volumes across container replacement. Secret files and instance recovery material live in an operator-controlled directory with an encrypted off-server recovery copy. Instance identity and verification trust anchors must survive recreation. An ordinary `compose down` must not remove volumes; destructive volume removal belongs only to an explicit decommission procedure.

Containers run with dedicated non-root identities where supported, dropped capabilities, no privilege escalation, explicit writable mounts, bounded PIDs, and log rotation. Do not mount the Docker socket. Separate public ingress from backend networking; allow outbound access only as required for email, OAuth, backups, and deletion evidence. Mount secrets only into services that need them. Compose file secrets are file delivery, not an encrypted secret vault; protect their source files and recovery copies. See [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/).

Startup order is configuration/secret validation, PostgreSQL readiness, explicit migration completion, deletion-ledger reconciliation, then web/worker readiness and proxy admission. Dependency startup ordering alone does not prove the database schema or restored account data is safe. Do not run migrations independently in each web process. A process liveness probe must not cause repeated restarts solely because SMTP or object storage is temporarily unavailable; report dependency health separately.

## Origin, HTTPS, and trusted proxies

Use one dedicated origin, represented in documentation as `https://pr0.example.com`; the example is not an allocated domain. Web, `/api/v1`, and `/api/auth` share that origin. Prefer the existing operator proxy if it satisfies the same contract; the reference setup uses Caddy for HTTPS certificate management. Persist certificate state, publish correct DNS, permit certificate issuance/renewal, redirect HTTP to HTTPS, and test renewal before release. No subpath hosting is supported initially.

The reference Caddy instance is the only public entry point. It discards client-supplied forwarding identity headers and writes one canonical client-IP header from its actual peer address. The application accepts that header only from the explicitly configured ingress peer/network; direct backend access is blocked. Without a trusted peer, use the socket address, never arbitrary `X-Forwarded-For`. Do not trust every private address by default. If a CDN or existing proxy is introduced, enumerate its exact trusted ranges, use right-to-left chain validation, and strip/rewrite headers at the final trusted boundary. Document this topology and test spoofed headers. See [Caddy trusted proxy configuration](https://caddyserver.com/docs/caddyfile/options).

Validate Host/origin against configured allowed origins; do not derive OAuth, recovery, or email links from an untrusted request Host. Restrict browser CORS to exact approved origins, enforce CSRF/origin checks, and use Secure/HttpOnly session cookies. Desktop uses native HTTPS transport and independent bearer sessions. Set proxy upstream timeouts above the 25-second long-poll duration (initially 40 seconds). Bound decoded application JSON to 4 MiB; reject unsupported request compression initially and enforce encoded body limits at the proxy too. Test that proxy limits preserve the supported synchronization envelope and do not buffer long polls indefinitely.

## Configuration, secrets, and external accounts

The implementation must publish a validated configuration schema and a secret-free example. The following are required configuration groups, not claims that these environment variables already exist:

| Group | Required values |
| --- | --- |
| Instance | Persistent instance ID, canonical HTTPS origin, operator contact, environment/release identifier |
| Database | Internal endpoint/database, least-privilege application credential, separate migration and backup credentials |
| Authentication | Better Auth secret, exact trusted origins, enabled providers, registration mode |
| Email | SMTP endpoint/port/TLS policy, credential secret, verified sender, reply/support address |
| Recovery | Encrypted backup repository, independent deletion-ledger endpoint/bucket/prefix, credential files, recovery key references |
| Deletion verification | Active Ed25519 signing key, key ID, pinned public trust anchor and complete signed rotation chain |
| Operations | Trusted proxy peers, quotas/throttles, resource budgets, metrics/alert destinations, log retention |

Validate required values and refuse initial public readiness on missing or contradictory configuration. Secrets must never use public frontend prefixes, appear in build arguments, be embedded in desktop installers, or be logged. Use mounted secret files read server-side; encrypt offline recovery copies and keep decryption access separate from the server. Keep signing secrets out of the normal web service where practical; expose only the narrow deletion-signing operation. Key rotation must retain verification continuity for indefinitely offline devices.

Each operator needs a host/Docker administrator account, control of DNS/TLS, a transactional email account, off-server backup/deletion storage accounts, an independent monitoring/alert channel, and recovery access held by the primary and backup operator. OAuth provider accounts are optional for self-hosters. Public-service Windows signing and release hosting belong to Umami, not every self-hoster. No subscription or certificate has been purchased in this task.

## Authentication providers, email, and registration

The public service offers Google, GitHub, and verified email/password access. Register separate provider applications for production and staging. With the selected `/api/auth` prefix, callbacks are exactly `https://<instance-host>/api/auth/callback/google` and `https://<instance-host>/api/auth/callback/github`. Register the canonical HTTPS origin, required consent/support information, and minimum identity/email permissions. Publish provider apps for the intended audience and exercise real production-mode callbacks before release. Better Auth documents the [Google](https://better-auth.com/docs/authentication/google) and [GitHub](https://better-auth.com/docs/authentication/github) setup; revalidate callback behavior against the pinned version.

Disabled providers have no visible login button and reject direct attempts. Missing credentials for a configured provider fail readiness. Email/password remains a complete supported route without social credentials; there is no verification bypass or shared bootstrap password. Preserve verified-email enforcement, explicit linking without email-based automatic merging, recovery for social-only accounts, independent device approval, and server-owned browser/device provenance. Enabling a provider must not enable unguarded sensitive Better Auth routes.

Select authenticated SMTP with required TLS as the portable email adapter. Reuse an existing suitable transactional provider; the actual account/sender remains an operator input. Configure sender-domain authentication using the chosen provider's instructions and test delivery, bounce handling, and throttling. Self-hosting a mail server is not required. Initial link lifetimes are 60 minutes for account verification and new-address verification, and 15 minutes for password recovery; tokens are single-use and bound to the relevant account/email version. These are deployment defaults to encode in the authentication implementation.

Browser reauthentication retains the contract's eight-digit code, five-minute expiry, three wrong attempts, browser/account/email-version binding, and ten-minute proof. Resending invalidates the previous challenge. Sending or retrying a message never extends a token/challenge lifetime. Mail delivery, a social callback, and device approval are not fresh-authentication proof by themselves.

Enqueue bounded mail jobs durably in PostgreSQL before reporting that delivery was requested. Encrypt persisted token-bearing payloads with a separately recoverable key; redact them from logs. Initial delivery retries use exponential backoff from 30 seconds up to five minutes, with jitter, at most five attempts and no retry after token expiry. Reauthentication retries must finish within its five-minute lifetime. Bounces/permanent rejections stop retries and appear in operator health. Avoid logging addresses; keyed address hashes may support counters and diagnostics with bounded retention.

Verification failure leaves the account unverified; password-reset delivery failure leaves existing credentials unchanged; failed new-address verification leaves the old account email active. A committed email change records a durable notification job to the old address. Retry that notification for up to 24 hours and alert on terminal failure; do not roll back the verified change or report a notification as delivered when it was only queued. Reset/signup responses remain non-enumerating, while signed-in verification/reauthentication screens can show a delivery/retry problem. SMTP acceptance is not proof of inbox delivery. During a known mail outage, pause new registration, keep existing usable login methods available, and do not bypass verification or freshness requirements.

The public service starts with open registration only after release gates pass. Self-hosted defaults use closed registration: an authenticated local operator command temporarily opens registration or manages an exact-email allowlist, then closes it after onboarding. Modes are `open`, `allowlist`, and `closed`; they gate all new account creation, including OAuth and direct auth routes, without blocking existing-account login/recovery/linking. Allowlisted accounts still verify their email. Suspension and registration pause are audited local operator operations; no public administrative dashboard is required for this MVP.

## Abuse controls and bounded admission

Enforce limits atomically in PostgreSQL across processes and restarts, using short-lived buckets and bounded cleanup. If enforcement storage is unavailable, do not admit unbounded protected work. Return HTTP 429 or 503 as appropriate, stable error codes, and explicit retry delays; clients retain drafts and pending operations. These initial configurable limits supplement, and never weaken, the account/API contract:

| Boundary | Initial limit |
| --- | --- |
| Signup | 5 attempts/hour/client-IP bucket |
| Verification, recovery, new-email verification, and reauthentication mail | Shared 3 messages/hour/destination address; 20/hour/client-IP bucket |
| Failed login | 10 failures/15 minutes/account-and-IP pair; 50 failures/15 minutes/client-IP bucket across accounts |
| Anonymous authentication requests | 60/minute/client-IP bucket, burst 10; includes device-code initiation/redemption and invalid-code attempts |
| Authenticated API | 120 requests/minute/account; admission includes long-poll starts |
| Mutation work | 1,200 operations/minute/account, burst 200; maximum 100 operations and 4 MiB decoded JSON/request |
| Public edge flood ceiling | 600 requests/minute/client-IP bucket, burst 60; validate shared-NAT behavior |
| Active request work | 16 server-wide, four/account; at most 64 queued, queue deadline five seconds |
| Long polls | 100 server-wide, four/account, outside active-work slots while waiting; maximum 25 seconds |
| Search | Two workers total, one active search/account, 32 queued total, two-second queue deadline; cancel obsolete typeahead |
| Snapshot/rebuild | One snapshot build and one per-library index rebuild at a time, yielding to interactive work |

Use an IPv4 /32 or IPv6 /64 as the client-IP bucket, after trusted proxy processing. Per-account controls still apply behind shared NAT. The broader IP limits prevent distributing attacks across account names; operators may raise a documented shared-NAT ceiling without removing per-account/email protections. CAPTCHA remains deferred until observed abuse warrants it. Alert on unusual signup/mail failures and sustained limiter rejection; never interpret suspension/throttling as account-deletion evidence.

Device polling must honor the advertised interval and slow-down responses. Valid polling must not exhaust the anonymous limit during a normal approval session. Deduplicate concurrent account search/snapshot work, bound payloads before expensive normalization, and preserve full query semantics: a resource limit yields retry/preparation, not truncated candidate results. Total search caches remain within the contract's 512 MiB across both workers. Resource tuning must pass normal traffic and 1,000-operation reconnect tests, not just reject abusive traffic efficiently.

## Persistent search and storage management

PostgreSQL remains canonical. Workers transactionally apply complete changes and their revision marker to persistent SQLite projections; reopen and catch up on restart. Search waits for the requested committed revision and otherwise returns explicit `search_preparing` with retry guidance. A failed index update does not roll back an acknowledged canonical write. An expired change cursor, corruption, or normalization incompatibility triggers a per-library staged rebuild and catch-up, followed by atomic activation and old-file reclamation after readers release them.

Maintain one rebuild at a time. Preflight measured canonical snapshot, normalized text/index, WAL, and temporary-file requirements plus safety reserve; if insufficient, pause the rebuild and request storage expansion. Never delete canonical data or acknowledge incomplete search to recover space. Remove an account's projections and caches when purging the account. Include short-posting dictionary growth, old normalization versions, operation-receipt history, backup staging, and competing snapshots in capacity measurements.

Warn at 70% filesystem use and expand before 80%; also alert when projected seven-day growth reaches 80%. A 64 GiB volume therefore has a 44.8 GiB warning and 51.2 GiB expansion boundary. Maintain bounded WAL/archive and log staging; stop admitting additions before exhausting durable storage, with explicit retry errors and retained client work. Allow deletions/reductions where they can commit safely. Failure to archive WAL must alert before its growth fills the volume. A fixed-size volume does not reserve 100 MiB for every registered account.

## Ordinary backups and deletion evidence

Use two independently managed repositories: encrypted ordinary PostgreSQL backups and minimal deletion evidence. They may use one managed object-storage provider but must have separate buckets, credentials, retention policies, and recovery permissions. The reference storage capability is strongly consistent, versioned object storage with immutable retained versions, such as Amazon S3; an alternative must pass the same failure/restore tests. No actual provider account or region is selected or claimed provisioned here. See [S3 consistency](https://aws.amazon.com/s3/consistency/) and [Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html).

For ordinary data, take a daily full physical PostgreSQL base backup and continuously archive WAL off-server, forcing segment switching initially every five minutes. Native PostgreSQL backup tooling must verify manifests/checksums and record the newest recoverable transaction timestamp only after required base/WAL objects are durable off-server. `archive_timeout` alone is not backup success. Stream/encrypt uploads with bounded local staging; no whole-database in-memory buffers. PostgreSQL describes base-backup/WAL recovery in its [continuous archiving guide](https://www.postgresql.org/docs/17/continuous-archiving.html).

Target at most one hour of ordinary data loss and a full restore within 24 hours. Warn when the newest recoverable checkpoint is 30 minutes old; page the operator at one hour or on a broken chain. Retain ordinary backup data for at most 30 days. Schedule explicit deletion of expired objects and all retained versions at day 29, verify removal before day 30, and alert on failure; do not rely solely on asynchronous bucket lifecycle deletion. Keep base/WAL dependency groups consistent when expiring them, and document the resulting available restore window rather than promising every instant of a full 30 days. Prune local backup staging too. Encrypt backups in transit and at rest, with independently stored recovery keys. Test restore after key rotation.

Do not put prompt-bearing backups under indefinite object holds. A completed account deletion removes live data immediately, while pre-deletion ordinary backups expire within 30 days of deletion at the latest. Database backups do not replace the deletion ledger. Search projections may be rebuilt instead of backed up; time for rebuild/catch-up counts toward recovery validation. Back up instance configuration, trust material, and required recovery secrets separately with appropriate encryption and retention; avoid retaining obsolete prompt-bearing exports or support bundles.

The deletion ledger stores only opaque account/instance/handle/deletion identifiers, intent/completion state, timestamps, signed receipts, hashes, and verification-key continuity, indefinitely. No email, profile, prompt text, or raw session credential belongs there. Write intents, completion receipts, and rotation records as immutable uniquely keyed objects under a dedicated prefix; protect their versions with non-expiring holds and deny overwrite/delete/hold-removal to application credentials. Administrative removal privileges are separate recovery credentials. A merely local ledger or an asynchronously copied database table cannot satisfy acknowledged-deletion durability.

Use a single fenced deletion coordinator and an ordered, hash-linked manifest with an independently stored current head. Update the head conditionally against its previous version; retain prior manifest versions. Publish an immutable record before advancing the head, and regard it as committed only when the remote store has durably acknowledged the conditional head update. A retry verifies existing content and resumes idempotently. Orphan objects from an interrupted publish are reconciled before opening service; missing manifest entries or conflicting contents block recovery. The implementation must prove complete replay against the remote head, not trust a checkpoint restored from an old database backup.

Deletion proceeds by denying account operations, committing independent intent, purging canonical live data/sessions/mail jobs/indexes/caches, then committing the signed completion receipt before acknowledging success. If remote evidence is unavailable, return visible pending/retry status and never claim success. After an intent is committed, recovery finishes the purge even if the originating session no longer exists. Pending intent is never returned as a completion receipt. Read-only receipt retrieval may use a verified cache during storage outage, but an absent cached receipt proves nothing. Preserve the original signed receipt bytes and full key chain indefinitely.

This path targets zero loss of acknowledged deletion evidence after loss of the application host, distinct from ordinary data RPO. It relies on the chosen off-server storage's durability and immutability contract and must be failure-tested; it is not a claim of immunity to arbitrary provider or privileged-account destruction. The backup operator must verify independent access and recorded head/key continuity during rehearsals. Loss or uncertainty of the ledger blocks restoration to public service.

## Restore runbook

1. Declare maintenance and fence the old deployment, background jobs, and deletion coordinator; block public admission. Record the incident, last known restore point, and operator. Prevent an old host from resuming writes using revoked credentials or verified infrastructure fencing.
2. On an isolated replacement, recover the exact release/configuration, immutable instance ID, encryption keys, deletion verification chain, and appropriate PostgreSQL version. Confirm ledger read access independently of the ordinary backup account. Do not generate a replacement instance/key under the old identity.
3. Read and verify the current independent ledger head and every referenced record/key transition; reconcile interrupted publications under exclusive ownership. Missing objects, broken signatures/hashes, incomplete listing, or inability to establish the current head keep the barrier closed.
4. Verify and restore a complete base/WAL chain to the selected recoverable point. Record actual data-loss interval. Revoke restored authentication sessions, unused device approvals, password-reset/verification tokens, fresh-authentication proofs, and token-bearing mail jobs; require login again while desktops retain local work. This prevents old backups from reviving revoked credentials or sending obsolete email actions.
5. Replay all deletion intents/completions against the restored account/library state before serving any library data. Finish pending purges and publish completion receipts idempotently through the independent ledger. Verify removed accounts, sessions, indices, snapshots, caches, and mail jobs are absent. Recheck the ledger head while the fenced coordinator is exclusively controlled.
6. Establish a new recovery epoch, invalidate old synchronization cursors and materialized snapshots, and rebuild/catch up search from restored canonical data with space preflights. Clients preserve pending work and a recoverable pre-refresh snapshot, then negotiate compatibility and authenticate before upload. Never re-upload all formerly acknowledged rows automatically.
7. Run isolated login, account-isolation, deletion-receipt, synchronization, and search probes. Establish fresh off-server backups and healthy monitoring. Open admission only after deletion replay is complete and core service health is verified; record timing, data loss, and any limitations.
8. Rehearse before public release and quarterly thereafter, including a newer deleted account present in the older backup, a pending deletion, key rotation, an unavailable/incomplete ledger, expired backup cleanup, and an indefinitely offline desktop. Demonstrate one-hour RPO, zero acknowledged-deletion loss, and 24-hour RTO; a successful database import alone is not a passed rehearsal.

## Migrations, upgrades, and recovery checkpoints

Publish a release manifest containing all image digests, schema/protocol/normalization versions, supported desktop release dates, configuration changes, migration instructions, expected downtime, and rollback conditions. The initial compatibility research pins are not permission to skip release integration tests. Run one Bun migration coordinator under a database advisory lock; record each migration/checksum transactionally, and use explicit resumable checkpoints for operations that cannot run in one transaction.

Before upgrading, verify disk/scratch space, healthy deletion evidence, a fresh off-server recovery point, and the prior release/configuration. Close admission when required, drain active work, run expand migrations, deploy the new application/workers, verify health and current/preceding-90-day client compatibility, then reopen. Delay contract migrations and removal of old normalization behavior until every supported client is covered. Serialize staged index upgrades and count simultaneous old/new indexes in the storage budget.

If a migration fails, keep admission closed and preserve volumes/checkpoints. Roll back only when the prior binary explicitly supports the resulting schema; never blindly downgrade a database or desktop schema. Otherwise repair forward or use the fenced deletion-safe restore procedure, accepting and recording its actual ordinary-data recovery point. Desktop installation updates must preserve local library/outbox data and refuse unsupported downgrades. A new desktop against an old self-hosted server negotiates compatibility before upload and gives an actionable update-required message without altering retained work.

## Monitoring, availability, and ownership

Umami owns the public service and official installers. Assign a named primary operator and a named backup operator, both with tested recovery access; their identities/contact routes remain required operator inputs. The primary owns releases, patching, registration/suspension decisions, abuse reports, provider billing, daily alert review, backup retention, and quarterly rehearsals. The backup covers absences and verifies recovery access. Page both on critical availability, deletion-ledger, or recoverability failures; establish an acknowledgement/escalation route capable of the 24-hour restore target.

Measure public availability from an independent location every minute using a bounded synthetic authenticated read/write/delete of a dedicated test prompt plus search and authentication readiness. Do not create/delete an entire account on every probe. Count a minute as available only when the core probe succeeds within its documented timeout; maintenance and missing probe coverage count as unavailable. Keep probe identity/data isolated and clean up retries. Publish the monthly ratio of available scheduled minutes to total scheduled minutes, targeting 99.5%. Keep local process health separate from measured end-to-end service availability.

Expose private metrics and structured redacted logs with release/trace IDs, status, duration, queue/worker state, and error categories. Do not log prompt content, email tokens, auth headers, credentials, or deletion handles. Retain ordinary diagnostic logs for seven days with per-container size caps; retain content-free uptime aggregates for 13 months and operator action/rehearsal records for 90 days. Metrics/admin endpoints are not public. Use existing off-host monitoring if available; do not add a large monitoring stack to the 4 GiB benchmark host.

| Signal | Initial operator action |
| --- | --- |
| Two consecutive external failures | Page primary and backup; include maintenance in downtime |
| Backup checkpoint age 30/60 minutes | Warn/page; inspect archive chain and available staging space |
| Any deletion-ledger write/verification failure | Page immediately; pending deletions stay pending; restore barrier stays closed |
| Search revision lag over five seconds for five minutes, queue age over two seconds, repeated `search_preparing` | Investigate worker/index health; compare end-to-end performance target |
| Disk 70%, projected 80% within seven days | Warn and plan expansion; complete expansion before 80% |
| Sustained 80% of memory limit, OOM/restarts, exhausted connection pools, growing WAL or snapshot staging | Investigate immediately; pause competing background work |
| Email queue oldest actionable job over two minutes or terminal failures | Alert; preserve token expiry and pause registration during outage |
| Rising 429/503 rates, quota/storage growth, failed-login/signup spikes | Investigate abuse or insufficient capacity; tune without relaxing isolation/durability |
| Backup cleanup failure, failed restore rehearsal, certificate expiry within 14 days | Page responsible operator and block release/upgrade until resolved |

Also track accepted operations versus receipts, per-library and physical storage, request/operation admission, snapshot age, full rebuild duration, newest successful restore rehearsal, and compatibility failures. Avoid unbounded account-labelled metric series. Alerts need tested delivery independent of the application's SMTP provider.

## Desktop installers and updates

Umami publishes one official per-user Windows 11 x64 installer usable with the public service or a chosen compatible instance. Prefer a signed NSIS installer with direct download and user-approved in-app updates. Publish immutable versioned assets and a signed Tauri updater manifest through an Umami-controlled release endpoint backed by GitHub Releases; ensure assets are publicly downloadable without repository credentials. Record the real hostname/repository and access policy before release. Keep supported releases for at least the 90-day synchronization window and recovery needs.

Windows Authenticode signing and Tauri update signatures are separate requirements. Select a hardware/cloud-backed signing identity controlled by Umami; the exact eligible signing service, legal identity, budget, and credential provisioning remain release inputs. Protect updater signing material separately from servers and test key rotation before distributing it. Signing does not promise immediate SmartScreen reputation. See [Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/) and [Tauri updater signatures](https://v2.tauri.app/plugin/updater/).

CI builds/test-signs only through a protected release workflow with explicit maintainer approval, immutable version/digest records, and least-privilege publishing credentials. Validate installation, update from supported releases with pending offline edits, rejection of modified update payloads, interrupted update recovery, and uninstall/data-retention behavior on the supported Windows matrix. No installer is published by this specification task.

The official client's update trust and endpoint remain Umami-controlled when a user selects a self-hosted instance; that server cannot substitute executable updates. Show the account and selected origin, allow “Use your own server” before login, and verify capabilities/instance identity over trusted HTTPS. Switching follows sign-out/pending-work safeguards and downloads the selected account's library. Existing build-time API-origin scaffolding must be extended to implement this selection. Self-hosters track the compatibility matrix; custom desktop forks own their identity, signing, and update channel.

## Self-hoster onboarding and support boundary

1. Read the support matrix and obtain a host, dedicated domain, trusted TLS, SMTP sender, off-server ordinary backup and independent deletion-evidence storage, plus external alerts. Start with the reference amd64 images and documented resource/storage allocation. Social-provider registration is optional.
2. Download a versioned Compose bundle and release manifest from the official project, verify its provenance/digests, create operator-owned secret files and persistent volumes, and configure one canonical origin. The runnable bundle, validation command, and exact installation commands must be supplied by implementation; none exists as a result of this document.
3. Run preflight for versions, filesystem ownership, space, configuration, connectivity, SMTP, remote ledger semantics/permissions, and proxy trust. Initialize the persistent instance identity and signing trust anchor once; securely export the encrypted recovery kit.
4. Start PostgreSQL, run the single migration coordinator, verify the deletion barrier, and start web/search/proxy. Closed registration is the default. Use the local operator allowlist command to admit the first account, verify its email, then keep registration closed or deliberately change mode.
5. Register optional Google/GitHub applications using this instance's exact callbacks and test them; otherwise use email/password. Validate recovery, browser reauthentication, device approval, provider-disabled routes, and old-address email notifications.
6. Create a small test library, connect the official desktop using “Use your own server,” verify online/offline changes and account/instance identity, then rehearse backup/restore and account deletion before relying on the instance. Configure alerts and record the operator/recovery contacts.
7. Follow release notes and compatibility windows for upgrades. Request support with redacted release/configuration/health information, never secrets or prompt/database dumps. Keep a reproducible reference configuration for troubleshooting.

Supported differences are origin, enabled social providers, registration mode, SMTP/storage providers satisfying the documented contracts, measured capacity, and operator contacts. Smaller hosts do not inherit the full public capacity/performance claim. Public-service availability is Umami's operating target; each self-hoster owns measurement, response, and recovery. Independent ledger durability, verified email, account isolation, supported compatibility, and deletion-safe restoration remain required for the documented supported setup. An intentionally reduced development installation must not be presented as meeting production support guarantees.

## Operator checklist and release evidence

The following inputs remain unfilled because the repository and user conversation do not identify them. They block a deployable public configuration; approving recommendations does not establish that resources/accounts exist.

| Required input | Selected direction | Evidence still required |
| --- | --- | --- |
| Host allocation | Existing Linux amd64 server; reserve 2 vCPU/4 GiB/64 GiB | Host identifier, actual available allocation, OS/CPU/filesystem inventory, growth capacity |
| Origin/proxy | Dedicated HTTPS origin; existing compliant proxy or Caddy | Real hostname/DNS owner, ingress topology/trusted peers, renewal test |
| Ordinary backup repository | Encrypted off-server base/WAL storage | Provider/region/account, bucket, recovery keys/access, retention verification |
| Deletion evidence | Independent immutable ordered ledger with durable remote acknowledgement | Provider semantics, dedicated bucket/permissions/holds, complete-head recovery and fencing tests |
| Email/social accounts | Existing transactional SMTP; public Google/GitHub apps | Sender/domain setup, quotas, credentials, consent/callback and delivery tests |
| Operations | Umami primary and backup operators | Names, independent alert contacts, access rehearsal, incident escalation |
| Installer release | Official signed installer and signed updates | Legal signing identity/service/budget, release endpoint, protected CI and tested updates |

Before release, implementation must deliver the pinned Dockerfiles/Compose bundle, configuration schema/example, migration and preflight commands, provider registration instructions, storage/secret initialization, bounded worker/limiter configuration, backup and deletion-ledger tooling, restore/upgrade runbooks with executable commands, monitoring setup, operator registration/suspension commands, compatibility matrix, and signed installer/update workflow. This document specifies those deliverables; it does not substitute for them.

Release evidence must include:

- The exact supported host/runtime/browser/Windows versions and reproducible load fixtures: 1,000 accounts, 10 GiB aggregate text, 20 active users, 10 API requests/second for 30 minutes and 30/second for one minute, including 10,000 prompts/100 MiB in one library. Include noisy/Unicode data, receipt/history growth, backups, search and rebuild contention, disk reserve, memory, and shared-NAT abuse controls.
- The operating envelope's p95 budgets: warm launcher 200 ms; search including debounce/render 150 ms; copy confirmation 150 ms; local durable save 200 ms; cold desktop 3 seconds; signed-in web 2 seconds; cross-device propagation 5 seconds. Initial maximum-library download/indexing must finish within 120 seconds; 1,000 queued edits/10 MiB within 60 seconds, excluding human conflict decisions.
- Interrupted sync/download, quota rejection and conflict preservation, real provider/email flows, verified-email enforcement, browser-only freshness and provenance, disabled/closed-registration bypass attempts, spoofed proxy headers, bounded overload and explicit retry behavior, and account isolation across server switching.
- Missing/corrupt index preparation, staged rebuilds under low disk/memory, compatible restart catch-up, migration failure/recovery, current and preceding-90-day clients, installed desktop updates with pending edits, signatures/tamper rejection, and accessibility/platform acceptance from issue 8.
- A timed deletion-safe restore after simulated host loss, newest acknowledged deletion absent from the ordinary backup, interrupted intent/completion publication, unavailable/incomplete ledger, key rotation and stale/offline device return. Demonstrate ordinary RPO/RTO, zero loss of acknowledged deletions, expired-object removal including versions, and successful independent alert delivery.

Known data loss, account-isolation failure, broken core keyboard flows, failed restore/update tests, or failed capacity/performance gates block release. No provisioning, load, restore, OAuth, email, or signing test has been performed by producing this specification. Issue 11's design handoff can be reviewed now; its actual operator inputs remain explicitly outstanding for the final readiness review in issue 12.
