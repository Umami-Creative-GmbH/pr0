# Coolify runs the hosted stack, with Phase as the source of its configuration and secrets

Status: accepted 2026-11-11. Supersedes the hosted topology of spec #120 (stories 35–37: "Coolify provides TLS and routing only") and the plain-Compose deployment with `infrastructure/hosted/redeploy.ts` that #128 first implemented.

The hosted service runs on the existing Coolify server. #128 first ran it as plain Docker Compose from a pinned checkout. In that design an operator script closed ingress, built the images, migrated, replayed deletions, checked and reopened. Secrets were root-owned files, and a systemd timer ran the backups. Coolify only routed traffic. That design kept a second deployment mechanism, a host checkout and a set of secret files next to the Coolify resources the operator already manages. We now run the stack the way the server runs everything else.

## Decision

- **Coolify runs the pr0 stack** as a "Docker Compose" application, built from this repository with [`compose.coolify.yaml`](../../compose.coolify.yaml). The update channel at `/update` stays a separate Coolify resource.
- **Every deploy runs the upgrade sequence as one-shot Compose jobs.** `backup-before` (a verified encrypted backup), then `migrate` (the single migration coordinator), are chained with `depends_on: condition: service_completed_successfully`. web, mail and the backup container depend on the last job, and the ingress depends on web. Coolify can't skip the sequence, because it is part of the Compose file it deploys. A failed job means web and mail never start on the new release.
- **Phase (self-hosted) is the source of truth for configuration and secrets.** Its Coolify integration syncs one Phase environment to the application's environment variables. Secrets reach the containers only as runtime variables: no secret files, no Compose secrets and no build arguments on the hosted service. The application still accepts `NAME_FILE` for other operators ([self-hosting](../operations/self-hosting.md)). The inventory is in [hosted variables](../operations/hosted-variables.md).
- **Backups run as a Coolify scheduled task** every 30 minutes in an idle tools container. The task reports its exit code to the dead-man's switch, as the systemd timer did.
- Initialization, restore and account administration stay manual operator commands. They run with `docker compose run --no-deps` against Coolify's project on the host, never as part of a deploy.

## Consequences

- Images are tagged with the deployed commit (`pr0:<commit>`, from Coolify's `SOURCE_COMMIT`), so each new commit changes web, mail, ingress and the backup container. Docker Compose (v5.7.0 locally) replaces those containers _before_ it runs the jobs. The old release therefore stops serving before the migration, which is the order the [compatible-upgrades](../operations/compatible-upgrades.md#server-deployment) runbook requires. After a failed job, the service stays closed with the data intact until a fixed commit is deployed. This has to be confirmed on the server's own Compose version during the first Coolify deploy.
- Without a closed-ingress phase there's no separate "check, then reopen" step. The ingress starts with the new web, which may answer 503 while it starts. The authenticated canary check moves to the probe host, which runs it every minute, and to the post-deploy run of the backup task, which is the verified backup after a deploy.
- Backups record the release that last _completed_ the schema (`/var/lib/pr0-release/release`, written by the migrate job), not the release being deployed. A backup taken before an upgrade then names the release that can restore it.
- Phase's sync is one-way and deletes Coolify variables that aren't in Phase. It doesn't redeploy, so a changed value, including the registration switch at the release act, applies on the next Coolify deploy. Its API token expires (30 days by default) and must be renewed.
- Secrets are now in Coolify's database and in the running containers' environment. Before, they were files readable only by root and the container users. Anyone with Coolify access to the application, or `docker inspect` on the host, can read them. Each secret variable must be runtime-only in Coolify, so it can't reach a build. No Dockerfile declares an `ARG`, so a mis-flagged variable still can't land in an image layer. The dead-man's switch URL also becomes an environment variable (#127 kept it in a credential file).
- Coolify names the Compose project and its volumes (`<application uuid>_recovery-state`, …), and since the 2026-11-11 amendment the database resource's volume holds the canonical library. Deleting or recreating either Coolify resource can remove the volumes that hold the canonical library, instance identity and recovery state. The runbook records the real volume names and forbids deleting the resource.
- Several Coolify behaviours are documented but not yet proven on this server: `service_completed_successfully` support, `SOURCE_COMMIT`, how a specific commit is deployed, the variable sync into a Compose application, `exclude_from_hc`, profiles, and where Coolify keeps the generated Compose file. The [hosted runbook](../operations/hosted.md#verify-on-the-first-coolify-deploy) lists each as a check for the first deploy.

## Considered options

- **Plain Compose with an operator script (#128 as first built):** it gives full control of the sequence (closed ingress, canary check, reopen). It was rejected because it adds a deployment mechanism and a secret store that sit outside the tools the operator uses for every other resource on the server.
- **Coolify pre- and post-deployment commands for the sequence:** rejected. The pre-deployment command runs in the _old_ container and is skipped on the first deploy. A failed post-deployment command still marks the deploy as successful, so it can't gate web and mail.
- **Secrets as files mounted by Coolify:** rejected, because Phase syncs environment variables, and the application already reads `NAME` when `NAME_FILE` is absent.

## Amendment 2026-11-11: a Coolify-managed PostgreSQL database, pr0's own backups kept

**Decision.** The hosted service's PostgreSQL is a Coolify-managed **PostgreSQL 17 database resource** on the same server, not a `database` service in `compose.coolify.yaml`. The Compose file no longer has a database service, its `postgres-data` volume or the internal `database` network. Services that use the database join the database resource's Docker network (external network `database`, named by `PR0_DATABASE_NETWORK`). The migration job and the operator commands mount its data volume read-only (`PR0_DATABASE_VOLUME_NAME`), only to measure free space before a migration. pr0 connects with `DATABASE_URL` as its **own non-superuser role** (`pr0`, `LOGIN CREATEDB`) and database, which the operator creates once. Coolify's `postgres` superuser stays in the vault and in the Coolify resource; it is used for setup and for fencing. `POSTGRES_PASSWORD` is gone from Phase. The setup checklist is in the [hosted runbook](../operations/hosted.md#coolify-database).

**pr0 keeps its own encrypted backups.** The `backup-before` job and the scheduled `backup create` task are unchanged: they dump the Coolify database and write encrypted, verified archives to the off-server Storage Box (`PR0_BACKUP_MOUNT`). Coolify's own database backups stay **off**. They can't replace pr0's: restoring a plain dump directly skips the restore barrier, writer fencing, the manual re-delete from the deletion log and the session and token reset (spec #120 story 8), and the release gate requires pr0's encrypted, verified backups (ADR-0002). If they are ever turned on, their retention must be 30 days at most, including versions and snapshots, and they must never be restored directly. An S3-compatible store on the same Coolify server isn't a valid backup target either: it shares the server's failure domain.

**Why.** The operator manages databases on this server as Coolify resources. A separate resource also outlives redeploys and changes of the application. The application runs as a dedicated role because the restore runbook fences every previous runtime role with an administrative connection; that is only possible when the application isn't the superuser.

**Consequences.**

- Two more Phase `config` keys (`PR0_DATABASE_NETWORK`, `PR0_DATABASE_VOLUME_NAME`); one secret fewer (`POSTGRES_PASSWORD`).
- The pr0 services that use the database share the destination network with other resources and with Traefik. Other containers on that network can reach web directly; such requests carry no ingress secret and fall into the shared rate-limit bucket. The database itself is protected by the `pr0` role's password and is not published.
- Restore provisions a **new** Coolify database resource as the empty replacement database, with a new `pr0` password. The old one is fenced through its administrative connection.
- The database's image, locale (the Debian image's `en_US.utf8`), durability settings and `pgcrypto` extension are now operator settings in Coolify, checked on setup, instead of being pinned in the Compose file.
- Not yet proven on the server: that Coolify keeps the Compose file's external network and volume, the database resource's volume and network names, and that it accepts the pinned image. The hosted runbook lists them as first-deploy checks. The local rehearsal (`test:hosted-deploy`) runs the database as a separate Compose project and creates the role as the runbook describes.

## Amendment 2026-11-11: no deletion replay job

[ADR-0005](0005-account-deletion-is-a-hard-delete-in-the-application-database.md) replaced the two deletion ledgers with a hard delete and a tombstone in the application database. The `replay-deletions` job is gone: a deploy runs `backup-before`, then `migrate`, and web, mail and the backup container depend on `migrate`. The ledger variables (`PR0_LEDGER_A_URL`, `PR0_LEDGER_B_URL`) are gone from Phase, and the hosted service needs no ledger hosts. The first deploy no longer fails on purpose: it starts, and the service stays closed (503) until the operator runs `restore initialize`, because no recovery state means no admission. The deletion log is a directory on the Storage Box (`PR0_DELETION_LOG_MOUNT`, a required `config` variable), mounted into web, restore, backup and deletions; see the [hosted runbook](../operations/hosted.md#deletion-log).

## Amendment 2026-11-11 (later): pr0 doesn't mount the database's data volume

**Decision.** By the release operator's decision, no pr0 container mounts the Coolify database resource's data volume. This replaces the read-only `database-data` mount and the `PR0_DATABASE_VOLUME_NAME` key from the PostgreSQL amendment above. The external volume, its mounts and `PR0_DATABASE_VOLUME` are gone from `compose.coolify.yaml`.

**Consequences.**

- One Phase `config` key fewer: only `PR0_DATABASE_NETWORK` remains of the two keys the PostgreSQL amendment added.
- The migration preflight still requires `PR0_MIGRATION_BACKUPS` and checks three times the database size plus 16 MiB free on it. `PR0_DATABASE_VOLUME` is now optional: where it is set (the bundled `compose.yaml`, self-hosted installs), the same check also runs on the database volume, as before. On the hosted service it isn't set, so that check doesn't run.
- `operations metrics` no longer expects a `database` storage measurement where `PR0_DATABASE_VOLUME_MOUNTED=false` (set for `web` and `operations` in `compose.coolify.yaml`), so that target raises no permanent `storage_coverage_missing:database`. A measurement that is still recorded keeps its 70 % and 80 % alerts. Everywhere else the database target stays expected.
- The database shares the Coolify server's disk. The operator turns on Coolify's server disk-usage notifications, which replace pr0's free-space measurement of that disk ([hosted runbook](../operations/hosted.md#coolify-database)).
