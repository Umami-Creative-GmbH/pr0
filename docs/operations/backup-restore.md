# Encrypted backups and deletion-safe restoration

The operator interface is `bun run --cwd apps/web backup …` and `bun run --cwd apps/web restore …`, also exposed by the Compose `backup` and `restore` services. Use the matching versioned application image and PostgreSQL 17 tools. Ordinary data has a **one-hour maximum loss window**, recovery has a **24-hour objective**, and ordinary copies expire within **30 days**. Acknowledged account-deletion evidence has **zero permitted loss** and indefinite retention independently of these backups.

## Storage and recoverable configuration

Mount a dedicated, non-versioned filesystem directory from a different server/failure domain at `PR0_BACKUP_MOUNT`. Use authenticated encrypted transport and storage that acknowledges durable flushes. The application cannot establish physical failure-domain independence by inspecting a mount path: include host-loss and remount checks in the installation rehearsal. Do not use the application disk, an asynchronous copy still awaiting upload, or an object-store mount with hidden versions. If the underlying storage has snapshots, replicas, recycle bins, or object versions, their ordinary-data deletion policy must also remove every version by 30 days; verify that policy at the storage boundary. The built-in filesystem cleanup cannot enumerate a provider's hidden versions.

Set `PR0_BACKUP_KEY_PATH` to a protected mounted file containing 32 random bytes in lowercase hex, and `PR0_BACKUP_RELEASE` to the immutable application image digest/release being backed up. Generate a key without displaying it:

```sh
umask 077
bun --bun -e 'await Bun.write("backup-key",Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"))'
```

Keep the key and its archive-date/key-version inventory in a separately recoverable secret store. Exercise retrieval from a second machine; a key stored only beside the destroyed application is not recoverable. Retain previous backup keys until all corresponding ordinary copies expire. Key rotation does not shorten signed deletion-key continuity: the independent ledgers retain that chain indefinitely.

Compose runs backup tooling as UID/GID 1000, the same identity as the web/restore image. Make the mounted backup directory and key readable/writable as appropriate for that identity; keep the key read-only. Mount recovery state read-only into web, mail and backup, and writable only into `restore`. Configure any additional secret mounts on **both** application and backup services. Never put credentials into browser build variables.

Each archive contains an authenticated encrypted PostgreSQL custom dump and an authenticated encrypted manifest. The manifest retains immutable instance/epoch identity, ordered migration checksums, release identity and effective `PR0_*`, `SMTP_*`, `BETTER_AUTH_*`, database and PostgreSQL TLS environment configuration; `_FILE` secrets are resolved into the encrypted configuration. The encryption key, recovery barrier and test/migration-scratch settings are excluded. Preserve the exact Compose overrides, ingress/firewall/TLS configuration, referenced CA certificates, image artifacts and operator secret-store access separately in the same protected configuration recovery inventory; the application cannot discover those external systems. Do not store secrets in Git.

Search volumes are derived: recovery rebuilds them from PostgreSQL. The `recovery-state` volume is outside PostgreSQL and must never be replaced by an ordinary database backup. Keep its **fenced incident checkpoint** separately from ordinary snapshots when one exists. Preserve both independently durable deletion stores, including private signing material, original public anchor and every rotation, using the [ledger storage requirements](account-deletion.md#independent-storage-configuration). Neither ledger is an ordinary backup payload and neither may be rolled back with the application database.

## Initialize and schedule

For a new empty installation, before starting web/mail:

```sh
docker compose run --rm accounts migrate
docker compose run --rm deletions initialize
docker compose run --rm restore initialize
docker compose up -d web mail
docker compose run --rm backup create
```

`initialize` refuses an existing recovery file or any existing account. To adopt an existing live installation, close ingress and follow the close/seal/prepare/open sequence below against its current database, without replacing the database. This also provides a first rehearsal. Do not remove a recovery file to bypass a closed barrier.

Run `backup create` at least every 30 minutes; complete each verified cycle within 30 minutes. Size the schedule and storage for the measured dataset. Large installations can instead use verified PostgreSQL base backups plus continuous WAL, but must retain this deletion-safe restore barrier and demonstrate the same objectives. A scheduled job alone is not evidence of recovery.

Creation streams AES-256-GCM encryption, reads the encrypted copy back, authenticates it, restores **all data/indexes/constraints into a fresh scratch PostgreSQL database**, checks identity and migration checksums, drops the scratch database and cleans up plaintext scratch. Only then does it record the conservative dump-start checkpoint in `backup_observation`. The operator connection needs permission to create/drop its randomly named scratch databases. Provide encrypted temporary disk storage and enough capacity for at least three times database size plus 16 MiB on the backup/verifier and PostgreSQL hosts. Do not serve scratch databases or expose their credentials to clients.

Every creation performs retention cleanup; `backup retention` can also run hourly. The command deletes ordinary archives older than **29 days**, leaving a one-day scheduling margin. Unexpected objects, links, incomplete cleanup, failed authentication or failed restore produce a redacted `backup_failed` event and a nonzero exit, and invalidate the current backup observation. Capture stdout/stderr/exit status in the operator's alerting system. The existing private metrics return `backup_unavailable` when a checkpoint or verification is over one hour old or cleanup is unsuccessful. Check those metrics at least once per minute from outside the application host, alert on absent coverage, and use the documented [storage and availability probes](service-health.md). Remove stale `pr0_verify_*` scratch databases and `pr0-backup-*` temporary directories after a killed verifier only after confirming no verifier still owns them; do not retain their plaintext beyond the ordinary retention window.

Commands for an existing archive (use its exact emitted identifier):

```sh
docker compose run --rm backup verify "$ARCHIVE"
docker compose run --rm -v "$PWD/recovery-private:/recovery-private" backup configuration "$ARCHIVE" /recovery-private/configuration.json
docker compose run --rm backup retention
```

The configuration export is a newly created private file, never console output. Verification uses a real scratch restore, including for a configuration export. Use the matching archived encryption key when inspecting an older key generation. No verification command advances the RPO timestamp of an old archive.

## Restore sequence

1. **Close ingress first.** Remove the old deployment from ingress, disable automatic restarts/scheduled jobs, and prevent its credentials/network identity from reaching PostgreSQL, either ledger, SMTP, or the replacement deployment. On a reachable host:

   ```sh
   docker compose run --rm restore close
   docker compose stop web mail
   ```

   The barrier is checked on every admitted request, including warm processes and long-poll reads. It is not a substitute for fencing a lost or older host. With a separate administrative database connection, fence every previous runtime role and terminate its sessions before making a new writer active. For the example runtime role `pr0_runtime`:

   ```sql
   ALTER ROLE pr0_runtime NOLOGIN;
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE usename='pr0_runtime' AND pid<>pg_backend_pid();
   ```

   Apply the corresponding credential/network fence at both ledger hosts and SMTP. Use new runtime credentials for the replacement. Record the old writer inventory, fencing evidence and time. If the old host cannot be reached, revoke access at the independent services/network boundary; do not assume it stopped.

2. **Recover authoritative deletion evidence.** With writers fenced, run `docker compose run --rm restore seal`. It reconciles both live independent stores and binds the complete ordered intent/key history into the external recovery state. A previously sealed checkpoint cannot be replaced with a smaller/new history. Store this incident file independently and retain it across retries. Receipt completion may be appended during replay; the sealed intents and key continuity cannot disappear.

   If a host was lost before sealing, recover the ordinary archive's instance identity/configuration and the **current authoritative** independent ledger stores. On an empty replacement database, `restore close <instance-uuid>` creates a closed barrier without an instance table. Restore the ordinary archive while closed, then seal against the current independent stores. Establish their current durable provenance before sealing: **two equal old copies do not prove completeness**. If all independent current evidence is unavailable or its provenance is uncertain, keep ingress and the barrier closed. Never seal two ordinary backup copies to manufacture evidence, and never run `deletions initialize` during recovery. The fenced checkpoint catches both copies being rolled back after sealing; it cannot reconstruct evidence lost from every independent failure domain.

3. **Restore the compatible ordinary database.** Provision an empty replacement database using the intended PostgreSQL major version, matching application release and recovered encryption key/configuration. Keep the new connection private and ingress closed. `backup restore` refuses nonempty databases, an absent/open barrier, another instance or a different configured release:

   ```sh
   docker compose run --rm backup restore "$ARCHIVE"
   ```

   For retry after interruption, inspect the target. The database import is a single transaction; do not drop a nonempty database automatically. Retry only against an explicitly verified empty replacement. Recover the pinned anchor from the restored database and the current signing chain from the independent ledgers. Explicit migrations, when needed, must use a compatible image and the normal migration coordinator; a failed migration never opens the restore barrier.

4. **Invalidate credentials and purge.** Generate a new `BETTER_AUTH_SECRET`, update all replacement web/operations processes, and retain the old value only in protected archival configuration. Rotation is required because email-verification tokens can be stateless. Then run:

   ```sh
   docker compose run --rm restore prepare
   ```

   Preparation refuses absent/changed/behind evidence or unchanged auth secrets. It durably registers the exact minimal claims for restored pending deletions not yet in the ledger before appending them. Retries allow only those additions while preserving the original sealed history; reopening also requires their evidence to exist. In one transaction it removes restored sessions (cascading fresh proofs and challenges), verification/action tokens, device codes/approvals, social pending state, all old mail jobs/reservations, provider access/refresh tokens and materialized snapshots. It increments authentication versions and establishes the incident's new epoch. It then replays every deletion, finishes pending intents, independently scans ownership columns for surviving deleted data, verifies signed completions and checks deleted search paths. Finally it stages and catches up every remaining library's search projection. Any error leaves admission closed. Retry `prepare` using the same recovery file/epoch. Mail is held closed until preparation finishes.

5. **Verify and reopen.** Start the replacement web/mail processes with new credentials, while ingress remains closed. Public readiness intentionally stays 503 until reopening; the operator command performs the same readiness checks privately. Reestablish verified backups and outside monitoring:

   ```sh
   docker compose up -d --force-recreate web mail
   docker compose run --rm backup create
   docker compose run --rm restore open
   ```

   `open` rechecks ledger completeness, deleted-data absence, current epoch, rotated auth secret, schema/email/search readiness and a fresh verified backup made after closing. It emits actual elapsed recovery seconds. Only then restore ingress and run the external authenticated library/search probe. Record incident time, selected archive checkpoint, actual lost interval and completion time; report any missed one-hour/24-hour objective explicitly. Warm processes with the prior auth secret or another instance/epoch remain inadmissible.

Returning desktops must reauthenticate to the same retained instance/account, fetch the new-epoch snapshot and preserve pending edits plus a recoverable old local snapshot. Previously acknowledged rows absent from the restored server are retained for explicit recovery; they are not automatically re-uploaded. A signed matching deletion receipt remains authoritative across restoration and key rotation; unsigned absence or an authentication error never authorizes a wipe.

## Pre-release and quarterly rehearsal

Run `bun run --cwd apps/web test:backup-restore` on a disposable deployment, plus `PR0_RESTORE_NATIVE=1` with Rust/MSVC, Windows Credential Manager and an installed browser available. Build the test tools image once using `docker build --target migration-runtime -t pr0-migration-test-58 .` (the fixture reuses the migration-tools image). The runner owns only `pr0-restore-61`, ports 30461 and 55461–55463, SMTP 11461/18461, and its generated rehearsal directory. Set `PR0_TEST_NATIVE_ORIGIN=https://localhost:30462` and `PR0_TEST_BROWSER=msedge` as needed.

Before public release and every quarter, repeat the same journey with the operator's actual off-server storage, independent ledger hosts, vault/key retrieval and representative dataset: back up a library, make and acknowledge a later account deletion, rotate signing keys, fence writers, lose the application host, restore, try unavailable/two-behind/one-current ledger copies, fail a purge, interrupt before reopen, and return a desktop with pending work plus acknowledged rows newer than the checkpoint. Verify old sessions/action tokens fail and the deleted account is absent. Measure archive retrieval/decryption, full restore, ledger replay, independent purge verification, search rebuild, reauthentication, total RTO and actual ordinary loss window. Verify every storage version's oldest ordinary data and deliberately fail cleanup to test alert delivery. Retain redacted logs and measurements externally. A small local rehearsal establishes behavior, not production capacity or host-loss durability.

See [recorded issue #61 evidence](../evidence/issue-61-backup-restore.md).
