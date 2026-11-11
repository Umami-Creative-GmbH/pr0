# Hosted service on Coolify

The hosted service at `https://pr0.umami-creative.app` runs on the existing Coolify server as a Coolify **Docker Compose application**, built from this repository with [`compose.coolify.yaml`](../../compose.coolify.yaml). [Phase](https://docs.phase.dev) (self-hosted) holds every configuration value and secret and syncs them to the application's environment variables. The update channel stays a separate Coolify resource at `/update` ([update channel](update-channel.md)). [ADR-0004](../adr/0004-coolify-runs-the-hosted-stack-with-phase-as-config-source.md) records why.

```text
Phase ──sync──> Coolify application variables ──> containers (runtime only)

client ─HTTPS─> Traefik (Coolify) ─┬─ /update ──> update-channel resource
                                   └─ /       ──> ingress:8080 ──> web:3000 ──> Coolify PostgreSQL 17
                                                                               (separate resource)
web, mail, jobs ──> ledgers A and B (external)      backup jobs ──> Storage Box (PR0_BACKUP_MOUNT)
```

PostgreSQL is a **Coolify-managed PostgreSQL 17 database resource** on the same server, not part of the Compose file ([Coolify database](#coolify-database)). pr0 still makes its own encrypted, verified backups to the off-server Storage Box; Coolify's own database backups stay off.

pr0 stores no files: its only state is PostgreSQL, the rebuildable search volume, the recovery and release records and the backups. An S3-compatible storage app on the Coolify server isn't used by pr0, and it is **not** a valid backup target: it shares the server's failure domain, and object stores with hidden versions are forbidden for backups ([backup storage](backup-restore.md#storage-and-recoverable-configuration)).

## What a deploy does

Every Coolify deploy, whether started by **Deploy**/**Redeploy** or the deploy webhook, builds the images for the deployed commit and runs `docker compose up`. The Compose file chains the upgrade sequence as one-shot jobs. Each job starts only after the previous one completed successfully:

| Order | Service | What runs |
| --- | --- | --- |
| 1 | `backup-before` | `backup before-upgrade`: a verified, encrypted backup on the Storage Box, labelled with the release that last completed the schema. It is skipped only for a database no migration has touched (the very first deploy) |
| 2 | `migrate` | The single migration coordinator (`accounts migrate`). It then records this release in `/var/lib/pr0-release/release` |
| 3 | `replay-deletions` | `deletions replay` from both external ledgers |
| 4 | `web`, `mail`, `backup` | Start on the new release. `backup` is the idle tools container for the scheduled backup |
| 5 | `ingress` | Starts once web's container has started. Coolify's proxy routes the domain to it |

Every image is tagged with the deployed commit: `pr0:<commit>`, `pr0-tools:<commit>` and `pr0-ingress:<commit>`. Coolify supplies it as `SOURCE_COMMIT`. So a new commit changes web, mail, ingress and backup, and Docker Compose **replaces those containers before it runs the jobs**. The previous release stops serving first, as [compatible upgrades](compatible-upgrades.md#server-deployment) requires. The database is a separate Coolify resource: a deploy never stops, replaces or waits for it. If it is down, `backup-before` fails and the sequence stops there.

**When a job fails,** the sequence stops there. web, mail, ingress and backup stay created but are never started: the service is closed, and the database and all volumes are intact. Coolify marks the deployment failed. Then:

- **Fix forward** (normal path): deploy a fixed commit. Its own `backup-before` runs first.
- **Go back to the previous commit** only if the schema is still compatible with it: the failure came before `migrate`, or `migrate` failed before it applied anything. Check the migrate job's log or `SELECT max(version) FROM migration`.
- Otherwise follow [disaster recovery](#restore-and-fencing). Never run initialization to get past an error.

Read a failed job's output under the application's **Logs**, or on the host with `docker logs <container>` (the containers are named after the service and the application UUID).

A redeploy of an unchanged commit and configuration doesn't replace web: it keeps serving while the jobs run again. `migrate` then has nothing to do and returns at once.

## Phase and Coolify setup (once)

### Phase

1. In the Phase app (`4da7482f-68e1-4b8d-b6d7-90e90cf7426b`), use one environment for the hosted service, called `<phase-env>` below. Add every key from the [variable inventory](hosted-variables.md) with its type: `config` for plain settings and `secret` for secrets. Don't use `sealed` until a sync has shown that Phase can push sealed values to Coolify. The administrative ledger URLs and the deploy webhook token never go into this environment.
2. Create the Coolify integration. You need Coolify's URL and an API token with read and write access but not "read sensitive". Point the sync at the pr0 Coolify **application**, scoped to `<phase-env>` (and a path, if you use one). The service account `d24c7cb8-359a-42fa-a2cc-a5fb07dff645` performs the sync.
3. The token expires after 30 days by default. Put its expiry date in the operations calendar and renew it at least a week early. When the sync fails, Coolify keeps the last values and nothing alerts.

The sync is one-way. It **deletes Coolify variables that aren't in Phase** and **doesn't redeploy**: a changed value applies on the next deploy. Change values only in Phase.

### Coolify database

pr0's canonical data lives in a Coolify **PostgreSQL** database resource in the same project and on the same server destination as the application. The Compose file has no database service. It reaches the database over the destination's Docker network and connects with `DATABASE_URL` as pr0's own role.

**Create it once** with **New resource → Database → PostgreSQL**, on the server and destination that run the pr0 application. Then go through this checklist before the first deploy, and record each value in the recovery inventory:

- [ ] **Version and image: PostgreSQL 17.** Set the custom Docker image to the image the self-hosted Compose file pins, `postgres@sha256:979c4379dd698aba0b890599a6104e082035f98ef31d9b9291ec22f2b13059ca` (Debian, PostgreSQL 17). If Coolify doesn't accept a digest, use `postgres:17-bookworm` and record the digest it pulled. Don't use an `-alpine` image: its collation library differs from the Debian image's, and ordering and text indexes must stay the same as in backups and restores. The backup tools in `pr0-tools` are PostgreSQL 17 too, so the server must not be a newer major version.
- [ ] **Administrator:** keep Coolify's generated superuser (`postgres`) and its password. Store that password in the vault. It never goes into Phase, the application or a command line. Use it only for the setup below and for [fencing](#restore-and-fencing).
- [ ] **Initial database** and **Initial database arguments:** leave Coolify's defaults. pr0 uses its own database, created below. The cluster's default locale must be `en_US.utf8` (the Debian image's default).
- [ ] **Custom PostgreSQL configuration:** leave it empty. pr0 needs PostgreSQL's defaults: `fsync`, `full_page_writes` and `synchronous_commit` on. pr0 needs no extra server settings or preloaded libraries. The only extension is `pgcrypto`, which ships with the image.
- [ ] **Public access:** off (**Make it publicly available** unchecked, no port mapping). Only containers on the destination network reach it.
- [ ] **SSL:** not needed. The connection stays on the server's Docker network, as the bundled database's did. If Coolify's SSL option is on, add `?sslmode=require` to `DATABASE_URL`. pr0's backups and migrations take `sslmode` from the URL, and the backup manifest records it. Certificate verification (`verify-full`) would need the CA file in every container, which this Compose file doesn't mount.
- [ ] **Coolify's own database backups: off.** They can't replace pr0's backups: restoring a plain dump directly skips the restore barrier, writer fencing, the sealed deletion ledger, deletion replay and the session and token reset ([restore sequence](backup-restore.md#restore-sequence)), and the release gate needs pr0's encrypted backups (ADR-0002). If an operator turns them on anyway, their retention must be 30 days at most, including every version and snapshot at the destination, and they must **never be restored directly**: only through `backup restore` of a pr0 archive.
- [ ] **Persistent storage:** note the data volume's name (shown under the resource's **Persistent Storage**, typically `postgres-data-<database uuid>`). Phase's `PR0_DATABASE_VOLUME_NAME` holds it: the migration job and the operator commands mount it read-only to check free space before a migration ([backup and restore](backup-restore.md#initialize-and-schedule) needs three times the database size plus 16 MiB on the PostgreSQL host).
- [ ] **Network and hostname:** note the destination's network (`coolify` by default; `docker inspect <database container> --format '{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{end}}'`) and the internal hostname from the resource's internal URL (the database UUID). Phase's `PR0_DATABASE_NETWORK` holds the network. The Compose file joins it as the external network `database` for every service that uses the database (not the ingress). Leave **Connect to Predefined Network** off on the application: the file already joins the network, and that option renames the application's containers.
- [ ] **Start** the database and keep it running. Never delete or recreate the resource: that removes its volume.

**Create pr0's role and database.** The application never runs as the `postgres` superuser: the [restore runbook](backup-restore.md#restore-sequence) fences every previous runtime role, which must be possible without locking out the administrator. Open the database resource's **Terminal** and run `psql -U postgres`:

```sql
CREATE ROLE pr0 LOGIN CREATEDB;
\password pr0
CREATE DATABASE pr0 OWNER pr0 TEMPLATE template0 ENCODING 'UTF8';
\c pr0
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

`\password` asks for the password without echoing it; generate it in the vault (for example `openssl rand -hex 32`). `CREATEDB` is needed because every backup verification restores into a randomly named scratch database (`pr0_verify_*`) and drops it again. The role gets no `SUPERUSER`, `CREATEROLE` or `REPLICATION`. Check the result:

```sql
SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'pr0';   -- f | t | f
SELECT datcollate, datctype FROM pg_database WHERE datname = 'pr0';                -- en_US.utf8 | en_US.utf8
SHOW server_version; SHOW fsync; SHOW full_page_writes; SHOW synchronous_commit;  -- 17.x, on, on, on
```

Put `postgres://pr0:<URL-encoded password>@<database uuid>:5432/pr0` into Phase as `DATABASE_URL`, and the network and volume names as `PR0_DATABASE_NETWORK` and `PR0_DATABASE_VOLUME_NAME` ([variable inventory](hosted-variables.md)).

### Coolify application

1. **New resource → Application → Public repository** `https://github.com/Umami-Creative-GmbH/pr0`. Choose the **Docker Compose** build pack, base directory `/` and Docker Compose location `/compose.coolify.yaml`.
2. Turn on **Include Source Commit in Build**. The Compose file requires `SOURCE_COMMIT` and refuses to deploy without it.
3. Under **Advanced → Deployment → Auto deploy**, choose **Manual deployments only**. Pushes must never deploy. **Deploy**, **Redeploy** and the deploy webhook still work.
4. Domains: set `https://pr0.umami-creative.app:8080` on the **ingress** service only. Leave every other service without a domain. Coolify generates the Traefik labels. Its router for the bare host has a shorter rule than the `/update` router, so `/update` still wins.
5. Run the first Phase sync. Then check that every inventory key appears under **Environment Variables**. For every `secret` key, clear **Available during build** so the variable is **runtime only**; Coolify enables it by default for new variables. No Dockerfile declares an `ARG`, so a secret can't reach an image layer, but a build-time variable still shows up in the build environment. Check the flags again after any sync that adds a key.
6. On the server, mount the Storage Box at `/mnt/pr0-backups` (`PR0_BACKUP_MOUNT`), owned by UID 1000.

### Routing and the ingress

Coolify's proxy reaches only the ingress. web publishes no port, and the ingress reaches it through the alias `pr0-web`, because a container of another resource on a shared Coolify network could answer to `web`. After the first deploy, find the network that Coolify's proxy shares with the ingress, and set `PR0_INGRESS_TRUSTED_PROXIES` to its subnet:

```sh
docker inspect <ingress container> --format '{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{end}}'
docker inspect coolify-proxy --format '{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{end}}'
docker network inspect <shared network> --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
```

Every container on that network can supply forwarded headers ([self-hosting](self-hosting.md#optional-example-ingress-behind-an-edge-proxy)). Until you know the subnet, use the `coolify` network's subnet, because the first deploy needs some value. Set `PR0_INGRESS_METRICS_ALLOW` to the probe host's public address ([probe host](probe-host.md)). The ingress answers 502 only while a new web is starting.

### Host commands

Initialization, restore and account administration run on the server with Docker Compose, against Coolify's project. They never run as part of a deploy. Coolify keeps the application's generated Compose file and variables in `/data/coolify/applications/<app-uuid>/`. Verify this on the first deploy and correct the path below if your version differs:

```sh
APP=<application uuid from the Coolify URL>
pr0c() { docker compose -p "$APP" --project-directory "/data/coolify/applications/$APP" \
  -f "/data/coolify/applications/$APP/docker-compose.yaml" --profile operations "$@"; }
pr0c ps --all
```

Always use `pr0c run --rm --no-deps <service> <command>`. Without `--no-deps`, Compose would start the services the command depends on, and for `backup` that is the whole upgrade sequence. If Coolify's directory has no `.env` with the variables, run the same commands through Phase instead: `phase run --app pr0 --env <phase-env> -- docker compose -p "$APP" -f compose.coolify.yaml …`. Run that from a checkout of the deployed commit with the `exclude_from_hc` lines removed and `SOURCE_COMMIT=<commit>` exported.

Coolify names the volumes. Record their real names in the recovery inventory, and never delete them:

```sh
docker volume ls --filter "label=com.docker.compose.project=$APP"
```

Expect `<app-uuid>_search-data`, `_recovery-state`, `_release-state` and `_migration-backups`. The canonical data is in the Coolify database's own volume (`PR0_DATABASE_VOLUME_NAME`), which belongs to the database resource; the application only mounts it read-only. Record it too. Never delete or recreate the Coolify application or the database resource: that can remove these volumes. Exclude them from any Coolify or Docker cleanup.

## First deployment

Run once. The ledger hosts, the Storage Box, Brevo, the OAuth apps and the vault entries must already exist (#130). Phase holds the **runtime** ledger URLs. The administrative URLs stay in the vault.

0. Create the [Coolify database](#coolify-database) and go through its checklist: PostgreSQL 17, the `pr0` role and database, Coolify's backups off, and the network and volume names. Then set up [Phase](#phase) and the [Coolify application](#coolify-application) with `DATABASE_URL`, `PR0_DATABASE_NETWORK` and `PR0_DATABASE_VOLUME_NAME`.
1. Pin the candidate commit ([Deploy a specific commit](#deploy-a-specific-commit)) and click **Deploy**. `backup-before` reports `backup_skipped` (empty database), `migrate` creates the schema and records the release, and **`replay-deletions` fails as expected**, because the ledgers aren't initialized yet. web and mail don't start.
2. Initialize the ledgers with the administrative URLs, which you export in the shell from the vault and never put on a command line or in Phase:

   ```sh
   read -rs PR0_LEDGER_A_URL; read -rs PR0_LEDGER_B_URL; export PR0_LEDGER_A_URL PR0_LEDGER_B_URL
   pr0c run --rm --no-deps -e PR0_LEDGER_A_URL -e PR0_LEDGER_B_URL deletions initialize
   unset PR0_LEDGER_A_URL PR0_LEDGER_B_URL
   ```

   Then create the restricted append-only runtime login on each ledger ([ledger configuration](account-deletion.md#independent-storage-configuration)). Phase must hold those runtime URLs.

3. Initialize restore state and admit the operator:

   ```sh
   pr0c run --rm --no-deps restore initialize
   pr0c run --rm --no-deps accounts admit-first <operator email>
   ```

   `restore initialize` and `admit-first` refuse a non-empty instance. Never run them again on this host, and never to get past an error.

4. Click **Redeploy**. All three jobs now pass: `backup-before` makes the first verified backup, and web, mail, backup and the ingress start. Go through [Verify on the first Coolify deploy](#verify-on-the-first-coolify-deploy).
5. Open `https://pr0.umami-creative.app`, sign up with the admitted address, verify by email and sign in. Check that `https://pr0.umami-creative.app/update/` is still served by the update channel.
6. Admit testers and the canary with `pr0c run --rm --no-deps accounts allow <email>`. Allowlist mode needs no redeploy for new addresses. Set up the canary on the probe host ([probe host](probe-host.md#canary-account-and-prompt)).
7. Create the [scheduled backup](#scheduled-backup) and run it once. Push ledger and backup storage measurements as described in [service health](service-health.md#storage-the-application-host-cannot-mount).

## Deploy a specific commit

Coolify builds the configured branch's current commit; its documentation doesn't describe pinning a commit. Pin a candidate in one of these ways, and **always verify the deployed commit afterwards**:

- If your Coolify version shows a **Commit SHA** field under the application's source settings, set it to the candidate's full commit.
- Otherwise set **Branch** to the candidate's annotated tag (`v<version>`). Tags never move.

Then deploy with **Deploy** or the webhook (`curl --fail -X POST "$COOLIFY_WEBHOOK" -H "Authorization: Bearer $COOLIFY_TOKEN"`). A queued webhook response proves only that Coolify accepted the request; watch the deployment to its end. The record of what runs is the image each container was created from:

```sh
docker ps --filter "label=com.docker.compose.project=$APP" --format '{{.Label "com.docker.compose.service"}} {{.Image}} {{.Status}}'
pr0c exec backup cat /var/lib/pr0-release/release
```

web and mail must show `pr0:<candidate commit>`, the ingress `pr0-ingress:<candidate commit>`, the backup `pr0-tools:<candidate commit>`, and the release record `pr0@<candidate commit>`. Keep both outputs and the Coolify deployment log as the candidate's deployment record.

## Redeploy a candidate

Every release candidate's server is deployed this way ([release act](release-act.md#2-redeploy-the-candidates-server)). Deploying counts as maintenance in the burn-in, not as a restart.

1. Pin the candidate commit and deploy it ([above](#deploy-a-specific-commit)). The jobs run in order; a failed job leaves the service closed ([What a deploy does](#what-a-deploy-does)).
2. Verify the deployed commit ([above](#deploy-a-specific-commit)).
3. Make the verified backup after the deploy: run the backup task once ([Scheduled backup](#scheduled-backup)). It must print `backup_verified` and exit 0, and it reports to the dead-man's switch. It is labelled with the new release. This run, not the next scheduled one, is the verified backup after a deploy.
4. Check readiness and the canary: `curl --silent https://pr0.umami-creative.app/api/v1/ready` must report every check `ready`, and the probe host's next minute must be available.

**When readiness stays `search_preparing`.** `/api/v1/ready` reports `search_preparing` until every account with edits has a current search projection, and a projection is rebuilt only by that account's next search. If every other check is `ready` and only `"search":"search_preparing"` remains, the new release is working: the canary's own search prepares its projection on the probe's next minute. Other accounts' projections catch up on their next search. Until then, `operations metrics` reports `readiness_unavailable` and the probe host alerts. Acknowledge the alert and record the readiness body with the deployment record. If any other check is unavailable, fix forward.

## Scheduled backup

Create a Coolify **Scheduled Task** on the application:

| Field     | Value                                |
| --------- | ------------------------------------ |
| Name      | `pr0-backup`                         |
| Command   | `sh /app/hosted/scheduled-backup.sh` |
| Frequency | `*/30 * * * *`                       |
| Container | `backup`                             |

[`scheduled-backup.sh`](../../infrastructure/hosted/scheduled-backup.sh) runs `backup create` and then reports its real exit code to the dead-man's switch check `pr0-backup`. It sends `POST <PR0_BACKUP_HEARTBEAT_URL>/<exit-code>` through [`heartbeat.ts`](../../infrastructure/hosted/heartbeat.ts) (3 attempts, 10-second timeout), because the tools image has Bun but no curl. `0` means success, and anything else marks the check down at once. The task exits with the backup's own code, so Coolify's execution history shows the result too. A missed run alerts after the 15-minute grace ([probe host](probe-host.md#dead-mans-switch)).

To run it by hand, use the application's **Terminal** on the `backup` container, or on the host:

```sh
pr0c exec backup sh /app/hosted/scheduled-backup.sh
```

While a failed deploy leaves the backup container stopped, scheduled runs can't start, and the dead-man's switch alerts after the grace time. That is intended: there is no verified backup until the fix is deployed. `operations metrics` raises `backup_unavailable` when no verified backup is less than one hour old.

## Change configuration

1. Change the value in Phase. Never edit it in Coolify.
2. Let the sync run (or trigger it), then check the value in Coolify's **Environment Variables**. For a new secret key, clear **Available during build**.
3. **Redeploy** in Coolify. The upgrade jobs run again; containers whose variables changed are replaced.

The registration switch at the release act uses exactly this path ([release act](release-act.md#55-open-registration)).

## Restore and fencing

Restore and initialization are manual. The generic sequence is in [backup and restore](backup-restore.md#restore-sequence). On Coolify, fence the writers like this before step 1, and keep them fenced until `restore open` succeeds:

- **Stop the application in Coolify.** That stops web, mail, the ingress and the backup container, and the route disappears. Coolify doesn't restart a stopped application.
- **Don't press Deploy, Redeploy, Restart or Start, and don't call the deploy webhook,** until the restore is open. Check that auto deploy is still **Manual deployments only**. A Phase sync doesn't redeploy, so rotating `BETTER_AUTH_SECRET` in Phase (required by `restore prepare`) is safe. The new value reaches the host commands through Coolify's `.env` or `phase run`.
- **Pause the `pr0-backup` check** in the dead-man's switch and **disable the scheduled task**. With the backup container stopped, the task can't run.
- **Fence the database writer** through an administrative connection: the old Coolify database resource's **Terminal**, `psql -U postgres -d pr0`, with the superuser password from the vault. Fence pr0's runtime role, not the administrator:

  ```sql
  ALTER ROLE pr0 NOLOGIN;
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE usename = 'pr0' AND pid <> pg_backend_pid();
  ```

  If the server is lost, the database is lost with it; fence the ledgers and SMTP as the generic sequence describes. Leave the old database resource stopped but don't delete it until the incident is closed.

- **The replacement database is a new Coolify database resource** (generic step 3, "provision an empty replacement database"). Create it with the [Coolify database](#coolify-database) checklist, including Coolify's backups off, and create the `pr0` role with a **new** password and an empty `pr0` database. In Phase, set `DATABASE_URL` to the new resource's hostname and password and `PR0_DATABASE_VOLUME_NAME` to its volume, let the sync run and check the values. `backup restore` refuses a non-empty database. The old database is never restored into or reused as the replacement.
- Run every restore command on the host with `pr0c run --rm --no-deps …`, for example `pr0c run --rm --no-deps restore close`. For `backup restore`, set the archive's release (see `backup configuration`): `pr0c run --rm --no-deps -e PR0_BACKUP_RELEASE=pr0@<commit> --entrypoint bun backup --bun apps/web/.operations/backup.js restore <archive>`. Use the tools image of that same commit, which may need a deploy of that commit first, and stop the application again after it.
- For step 5 of the generic sequence, start web and mail privately with `pr0c up -d --no-deps web mail` (no ingress). After `restore open`, if the restored archive's release differs from `pr0c run --rm --no-deps --entrypoint cat backup /var/lib/pr0-release/release`, write it into the release record, so the next `backup-before` labels the restored data correctly: `pr0c run --rm --no-deps -e PR0_BACKUP_RELEASE=pr0@<restored commit> --entrypoint sh migrate -c 'printf "%s\n" "$PR0_BACKUP_RELEASE" > /var/lib/pr0-release/release'`. Then **Deploy** the matching commit in Coolify, which starts the ingress through the normal sequence. Re-enable the scheduled task and resume the check.

## Verify on the first Coolify deploy

These behaviours are documented but not proven on this server. The local rehearsal (below) proves them only with plain Docker Compose. Record each result on #135.

- [ ] The deployment log shows `backup-before`, `migrate` and `replay-deletions` running one after another, and web and mail starting only after `replay-deletions` exited 0 (`service_completed_successfully` is honoured).
- [ ] A new commit's deploy replaces web, mail and the ingress **before** `backup-before` starts (the containers' creation time comes before the job's start time), as with Docker Compose v5.7.0 locally. Record the server's `docker compose version`.
- [ ] `SOURCE_COMMIT` is set: the containers run `pr0:<full commit>` images.
- [ ] The pinned commit or tag is the one deployed ([Deploy a specific commit](#deploy-a-specific-commit)).
- [ ] Phase's sync reaches this Compose application: every inventory key is present, and a key deleted in Phase disappears in Coolify. Check whether the sync resets **Available during build**.
- [ ] Every `secret` key is runtime only, and the build log shows none of their values.
- [ ] `exclude_from_hc` keeps the exited jobs from marking the application unhealthy.
- [ ] Profile `operations` services (`accounts`, `deletions`, `restore`, `operations`) are not started by a deploy.
- [ ] Coolify's generated Compose file and `.env` are where [Host commands](#host-commands) expects them, and `pr0c ps --all` lists the application.
- [ ] The volume names, recorded in the recovery inventory.
- [ ] The ingress sees Traefik's address inside `PR0_INGRESS_TRUSTED_PROXIES`, and client addresses are attributed ([service health](service-health.md#trusted-ingress)).
- [ ] The scheduled task runs in the `backup` container, its history shows the exit code, and the dead-man's switch receives `0`. A deliberate failure (`heartbeat.ts 1` in the container) alerts.
- [ ] The Coolify database resource accepts the pinned PostgreSQL 17 image (or `postgres:17-bookworm`), its volume is named as recorded in `PR0_DATABASE_VOLUME_NAME`, and it sits on the network in `PR0_DATABASE_NETWORK`.
- [ ] Coolify keeps the Compose file's external network `database` and external volume `database-data`: web, mail, backup and the jobs reach the database at its internal hostname, the migrate job sees the database volume read-only, and the ingress is not on that network.
- [ ] `SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = 'pr0'` shows only `pr0` (plus your own `postgres` session), and the schema's tables belong to `pr0`.
- [ ] Coolify's scheduled backups for the database resource are off.
- [ ] A deliberately failing deploy (for example a commit whose migration fails, on a disposable copy, or a missing required variable) leaves web and mail stopped and the data intact.

## Rehearse locally

`bun run --cwd apps/web test:hosted-deploy` rehearses this file with plain `docker compose` and Docker. It needs no prebuilt images, but its first build takes several minutes. It:

1. Checks the file: no Compose secrets, `NAME_FILE` settings or build arguments; the job chain and what waits for it; required variables; no `ARG` in any Dockerfile; and the [variable inventory](hosted-variables.md) against the variables the file reads.
2. Starts PostgreSQL 17 as a **separate** Compose project with its own network and data volume, as a stand-in for the Coolify database, and creates the non-superuser `pr0` role and database as [Coolify database](#coolify-database) describes. The application joins that network and mounts that volume as external resources.
3. Clones `HEAD` (or `PR0_HOSTED_FROM`) into `.scratch/` and adds three disposable commits: an ordinary candidate, a candidate with a failing migration, and its revert. For each deploy it removes Coolify's `exclude_from_hc` lines, as Coolify does, sets `SOURCE_COMMIT`, builds and runs `up -d` in one fixed project. Local stand-ins replace the ledgers, SMTP, the dead-man's switch and Coolify's proxy.
4. Runs the first deploy, which stops at `replay-deletions` before initialization, then initializes and redeploys. It runs the scheduled backup task with a success and a failure, and checks the heartbeat codes `0` and `1`. Then it upgrades to the candidate and checks that the backup taken before the upgrade names the previous release. It deploys the broken candidate: the sequence stops at `migrate`, and web, mail, ingress and backup stay created but not started. Finally it fixes forward and checks that the account, instance and canary prompt are intact.

Set `PR0_HOSTED_EVIDENCE=<file>` to keep each deploy's job results, order and container images. The recorded run is [docs/evidence/issue-128-redeploy.json](../evidence/issue-128-redeploy.json). Cleanup removes only the test's two randomly named projects, their volumes and network, and its image tags.
