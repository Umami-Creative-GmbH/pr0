# Account deletion evidence

Issue #56 adds browser confirmation, an account/library barrier, live-data purge and indefinitely retained Ed25519 receipts. `POST /api/v1/account/deletion` requires a verified browser session, an account/email-version match, authentication completed within ten minutes and `confirmation: "delete-account"`. Better Auth's direct deletion route remains disabled. GET on the same route supplies the immutable identities, random 256-bit handle and pinned verification anchor before confirmation.

The coordinator commits these boundaries in order: local deletion barrier and recovery work; intent in ledger A; identical intent in ledger B; live canonical-data purge; search-worker exclusion and exact index-file removal; signed completion in A; identical completion in B. It then removes local recovery work and returns success. Failure after the barrier returns retryable `pending`. Recovery does not require a session. A pending intent or an unsigned absence can never authorize desktop cleanup.

Before submission, the browser stores the minimal immutable identities, opaque handle and pinned verification material in origin-local storage, separately from the session. Reloading restores a status check that requires no account access. Browser cleanup uses the verified account/instance identity, so a late completion cannot clear another account's cache or unsaved draft. The receipt can be downloaded before dismissing the completed flow.

## Independent storage configuration

Supply **two PostgreSQL 17 databases on independently durable hosts/storage failure domains**, separate from the service database and each other. This is the concrete provider-neutral ledger implementation. Two containers or volumes on the application host do not satisfy the deployment requirement. The local acceptance Compose uses separate disposable containers only to exercise failure boundaries; it makes no production durability claim.

Configure `PR0_LEDGER_A_URL` and `PR0_LEDGER_B_URL` (or their `_FILE` equivalents) in web and operational jobs. Use TLS with certificate verification, encrypted disks and restricted network access. Keep `fsync`, `full_page_writes` and `synchronous_commit` on; the adapter checks them and refuses unlogged storage, the service database, and identical store identities. Both independent PostgreSQL commits must acknowledge before any completed receipt is returned. Provision storage that honors durable flushes. Do not acknowledge against an asynchronous replica or fail over to a stale replica. Loss of either entire host retains acknowledged records in the other; service remains closed to deletion completion until both stores are available and reconciled.

Apply application migrations first. For a **new** installation, use dedicated administrative ledger credentials to run:

```sh
docker compose run --rm accounts migrate
docker compose run --rm deletions initialize
```

Initialization creates append-only records, independent store identities and one signing anchor in both stores. It pins the public anchor in the service database. It refuses to manufacture a replacement for a previously pinned missing anchor. Keep the ledger administrator credentials out of normal web runtime. In each ledger database, create a separate login with a generated secret and grant only:

```sql
GRANT CONNECT ON DATABASE ledger TO pr0_deletion_runtime;
GRANT USAGE ON SCHEMA public TO pr0_deletion_runtime;
GRANT SELECT ON deletion_store TO pr0_deletion_runtime;
GRANT SELECT, INSERT ON deletion_record TO pr0_deletion_runtime;
```

The runtime login must not own the tables and must not be a superuser or inherit administrative privileges. Switch the two configured URLs to these credentials. The append-only trigger also rejects UPDATE, DELETE and TRUNCATE. Restrict ledger reads: records include private signing material. Store credentials and verification/signing material independently of ordinary service backups. Only opaque instance/account/deletion identities, handles, timestamps, signatures and key metadata enter the ledger; no email, profile or prompt text does.

All web replicas must use the **same search volume**. Search workers hold a PostgreSQL advisory lock for their entire projection lifetime; purge acquires the same lock before removing that account's exact resolved paths. Do not deploy separate unregistered search caches on replica-local disks. The supplied Compose has one web service and one persistent search volume.

## Replay and restoration

Use the complete [encrypted backup and restore coordinator](backup-restore.md) for a disaster recovery. `deletions replay` alone does not invalidate restored credentials, establish a new epoch, verify search readiness, or reopen admission.

Stop public ingress and application/mail processes before restoring the ordinary database. Never restore either deletion ledger from an ordinary hourly backup. Preserve both ledgers and their full append-only history indefinitely; use storage replication/retained independent copies in addition to the acknowledged two-store path. Ordinary service backups still expire within thirty days.

After restoring the ordinary database, keep ingress closed and run `docker compose run --rm deletions replay` using both current ledger stores and the shared search volume. Replay enumerates every intent with paginated key scans, reconciles missing records from the other store, reapplies purges and persists any missing completion. A missing store, missing pinned anchor, conflicting record or unavailable storage fails closed. Do not run `initialize` to bypass recovery failure. Resolve the storage failure and replay again. Both stores becoming stale together cannot be repaired from an older service backup; this is why ledger retention and independent failure domains are mandatory.

Web startup and readiness repeat complete replay before account operations are admitted. Every five seconds, the running service resumes local pending work. Once initialized, removing ledger configuration also blocks account access. Change the recovery epoch and follow the wider deployment restore procedure before reopening ingress. Rehearse loss of either ledger host and incomplete-copy repair before deployment and quarterly. This implementation does not certify an operator's infrastructure, the wider MVP restore-time target, or its backup retention policy.

## Receipts and key continuity

`GET /api/v1/account-deletions/{handle}` needs no session and returns only a compact signed receipt or unsigned `absent`, with `Cache-Control: no-store`. A storage error is an error, never absence. `GET /api/v1/account-deletions/verification` exposes the public anchor and signed rotation statements. Handles grant no library access. Avoid recording receipt handles in ingress access logs.

Receipts use the fully specified `Ed25519` JOSE algorithm from [RFC 9864](https://www.rfc-editor.org/rfc/rfc9864.html), the OKP/Ed25519 key format from [RFC 8037](https://www.rfc-editor.org/rfc/rfc8037.html), protected `kid` and `typ: pr0-account-deletion+jws`. Their exact payload is `version`, `instanceId`, `accountId`, `handle`, `deletionId`, `deletedAt`, without expiry. The shared client verifies the exact signing input before parsing claims and checks all three pinned identities.

Run `docker compose run --rm deletions rotate` to append a new key signed by its predecessor. Rotation uses `typ: pr0-deletion-key-rotation+jws` and binds the instance, old/new key IDs and new public key. Both stores retain the original anchor, every continuity statement and old receipts. A client's anchor is never replaced by an unauthenticated lookup response. Same-email recreation has a new immutable account ID and cannot inherit the former account's operations or deletion authority.

## Validation

Run `bun run --cwd apps/web test:account-deletion` for isolated real-PostgreSQL, independent-ledger and served-browser acceptance checks. The suite uses ports 30456, 55456–55458, 11456 and 18456 and owns only the `pr0-deletion-56` Compose project. It checks confirmation/freshness/provenance/identity, concurrent mutations, same-email recreation, unsigned absence, ledger failure, independent signature verification, rotation and recovery at the durable boundaries. Client conformance runs with the normal Bun test suite. Production retention and host-loss rehearsal evidence must come from the actual deployed independent storage.

Recorded results, the ordinary-database restore rehearsal and tool limitations are in [issue 56 validation evidence](../evidence/issue-56-account-deletion.md).
