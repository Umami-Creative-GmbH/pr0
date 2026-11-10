# Hosted service on the Coolify server

The hosted service at `https://pr0.umami-creative.app` runs on the existing Coolify server as **plain Docker Compose** from a pinned Git checkout. The checkout sits at exactly one commit, uses the fixed project name `pr0`, and adds the hosted overlay [`compose.hosted.yaml`](../../compose.hosted.yaml) to the production `compose.yaml`. The overlay adds the [example ingress](self-hosting.md#optional-example-ingress-behind-an-edge-proxy), joins Coolify's proxy network and labels the ingress so that Coolify's Traefik routes the origin root to it. The update channel stays a separate Coolify resource at `/update` ([update channel](update-channel.md)).

Coolify provides TLS and routing only. It has no application, service or Compose resource for this stack and never deploys it. Every release candidate's server is redeployed with the operator script [`infrastructure/hosted/redeploy.ts`](../../infrastructure/hosted/redeploy.ts) described below.

```text
client ─HTTPS─> Traefik (Coolify) ─┬─ /update  ──> update-channel resource (Coolify-managed)
                                   └─ /        ──> pr0-ingress-1:8080 ──> web:3000 ──> database
```

## Why Coolify must not manage the stack

The application's safety depends on operator commands running in a fixed order against the same project and volumes. These include one migration under a coordinator lock, deletion replay, the restore barrier and verified backups. A Coolify Compose resource breaks this in several ways:

- Every Git push or webhook redeploys with `docker compose up`. That skips the fresh-backup check, closed ingress, the single migration, deletion replay and the post-deploy backup. It can also start a new web image against an unmigrated schema.
- Coolify names projects and volumes itself and may rewrite the Compose file. A different project name selects different, empty volumes. Deleting or recreating the resource can remove volumes that hold the canonical library, instance identity and recovery checkpoint.
- An automatic redeploy can restart web or mail during a restore. That bypasses fencing (`restore close`, `prepare`, `open`) and can admit traffic against a restored database before deletion replay finishes.
- Coolify cannot run the one-shot operator commands (`deletions initialize`, `restore initialize`, `accounts admit-first`) or keep secrets as files outside its own storage.

Do not add this repository to Coolify as an application. Do not let Coolify's Docker cleanup touch the `pr0_*` volumes or the retained image tags. Coolify's own resources (Traefik, the update channel, the rehearsal channel) stay as they are.

## Host layout

| Path | Contents |
| --- | --- |
| `/opt/pr0` | The pinned checkout (`git clone https://github.com/Umami-Creative-GmbH/pr0.git`), detached at the deployed commit, owned by root |
| `/opt/pr0/.env` | Hosted configuration from [`infrastructure/hosted/hosted.env.example`](../../infrastructure/hosted/hosted.env.example), mode `0600`. No secrets |
| `/opt/pr0/.deployments/` | One JSON record per redeploy (ignored by Git) |
| `/etc/pr0/secrets/` | Secret files named in the example (`PR0_SECRET_DIRECTORY`): directory `0700`, files `0444` |
| `/etc/pr0/backup-key` | Backup key from the vault, readable by UID 1000 |
| `/etc/pr0/credentials/backup-heartbeat-url` | Dead-man's switch check URL for `pr0-backup`, root `0600` |
| `/mnt/pr0-backups` | Storage Box mount for encrypted backups (`PR0_BACKUP_MOUNT`), writable by UID 1000 |

The host needs Docker Engine with the Compose plugin, `git`, `flock` (util-linux) and Bun 1.4.4 at `/usr/local/bin/bun` for the redeploy script. The script's dependencies (`zod` and the repository's `@pr0/api-contract` package) are installed in the checkout with `bun install --frozen-lockfile --filter @pr0/hosted`. The overlay and the example contain no secrets. Each secret is a file. The application reads it through `NAME_FILE=/run/secrets/NAME`, as described in [self-hosting](self-hosting.md#prepare-configuration-and-storage).

`.env` sets `COMPOSE_PROJECT_NAME=pr0` and `COMPOSE_FILE=compose.yaml:compose.hosted.yaml`. Every plain `docker compose …` command run in `/opt/pr0` therefore uses the right project, overlay and release images, including the backup timer. Never run Compose for this stack from another directory or with `-p`.

Routing: Traefik discovers the ingress container from its labels on the `coolify` network. The routers `pr0-https` and `pr0-http` match `Host(pr0.umami-creative.app)` with priority 1, so every more specific router on the host wins, including `/update` and the rehearsal channel. HTTP redirects to HTTPS, and TLS uses Coolify's `letsencrypt` resolver. `web` publishes no host port; the ingress is the only path to it. The ingress reaches web through the project-network alias `pr0-web`, not the plain name `web`, because another container on the shared `coolify` network could answer to `web`. Start the ingress after web: if it starts first, it answers 502 for a few seconds until it resolves web again. Set `PR0_INGRESS_TRUSTED_PROXIES` to the `coolify` network's subnet and `PR0_INGRESS_METRICS_ALLOW` to the probe host's public address ([probe host](probe-host.md)).

## First deployment

Run once, as root, on the Coolify server. Ledger hosts, the Storage Box, Brevo, the OAuth apps and the vault entries must already exist (#130).

1. Check out the commit and configure:

   ```sh
   git clone https://github.com/Umami-Creative-GmbH/pr0.git /opt/pr0 && cd /opt/pr0
   git checkout --detach <commit>
   bun install --frozen-lockfile --filter @pr0/hosted
   cp infrastructure/hosted/hosted.env.example .env && chmod 600 .env
   ```

   Edit `.env`. Replace every `REPLACE_WITH_…` value; set the four release lines to `pr0:<first 12 hex digits of the commit>`, `pr0-tools:…`, `pr0-ingress:…` and `pr0@<full commit>`. Keep `PR0_REGISTRATION=allowlist`. Write every secret file listed in the example. For now the two ledger files hold the **administrative** ledger URLs (`?sslmode=verify-full`). `PR0_CANARY_COOKIE` can hold a placeholder until step 7. An OAuth secret file can hold a placeholder while its client ID is empty.

2. Validate and build: `docker compose config --quiet`, then `docker compose build web accounts ingress`.

3. Migrate and initialize the ledgers:

   ```sh
   docker compose up -d --wait database
   docker compose run --rm accounts migrate
   docker compose run --rm deletions initialize
   ```

4. **Switch to the runtime ledger roles.** Create the restricted append-only runtime login on each ledger ([ledger configuration](account-deletion.md#independent-storage-configuration)). Replace the contents of `PR0_LEDGER_A_URL` and `PR0_LEDGER_B_URL` with those runtime URLs. Administrative credentials go back to the vault only; they never stay on this host.

5. Initialize restore state and admit the operator:

   ```sh
   docker compose run --rm restore initialize
   docker compose run --rm accounts admit-first <operator email>
   docker compose up -d --no-build --wait web mail
   docker compose up -d --no-build --wait ingress
   ```

   `restore initialize` and `admit-first` refuse a non-empty instance. Never run them again on this host, and never to get past an error. Open `https://pr0.umami-creative.app`, sign up with the admitted address, verify by email and sign in. Then check that `https://pr0.umami-creative.app/update/` is still served by the update channel.

6. Admit testers and the canary with `docker compose run --rm accounts allow <email>`. Allowlist mode needs no recreate for new addresses.

7. Set up the canary ([probe host](probe-host.md#canary-account-and-prompt)). Put its prompt UUID in `PR0_CANARY_PROMPT_ID` and a copy of its cookie in the `PR0_CANARY_COOKIE` secret file. Renew this copy whenever you renew the probe host's copy. Then run `docker compose run --rm canary`; it must print `"available":true`. Right after the prompt is created, the first run may fail while search prepares; run it again.

8. Make the first verified backup with `docker compose run --rm backup create`, then install the [backup timer](#backup-timer). Push ledger and backup storage measurements as described in [service health](service-health.md#storage-the-application-host-cannot-mount).

## Redeploy a candidate

Every new release candidate's server, and every other change to the hosted service, is deployed with the script. Redeploying counts as maintenance for the burn-in, not as a restart. Fetch first, then run the script under the maintenance lock it shares with the backup timer:

```sh
cd /opt/pr0
git fetch --tags origin
bun install --frozen-lockfile --filter @pr0/hosted
flock --wait 1800 /run/lock/pr0-maintenance.lock bun infrastructure/hosted/redeploy.ts <commit>
```

The script refuses a checkout with local changes or a revision that isn't a commit. It takes all configuration from `.env` and ignores `PR0_*`, `SMTP_*`, `COMPOSE_*` and database variables in the operator's shell. It then runs the documented upgrade sequence and stops at the first failed step:

| Step | What runs |
| --- | --- |
| `preflight` | `operations metrics` must report `backup.status: ready` (a verified backup less than one hour old). The tools image measures free space for migration backups and backup verification scratch: each needs at least three times the database size plus 16 MiB |
| `close-ingress` | `docker compose stop ingress web mail`. Traefik drops the route; `/update` stays up |
| `build` | `git checkout --detach <commit>`, then builds the app, tools and ingress images tagged `pr0:<12 hex>`, `pr0-tools:<12 hex>` and `pr0-ingress:<12 hex>`. Only after all three exist does it rewrite the release lines in `.env`, including `PR0_BACKUP_RELEASE=pr0@<commit>` |
| `migrate` | One `docker compose run --rm accounts migrate` |
| `replay-deletions` | `docker compose run --rm deletions replay` |
| `recreate` | `docker compose up --force-recreate web mail` on the new image |
| `check` | The authenticated canary check (`canary` service: the availability probe's library and search check, run in web's network namespace with the canary session), then `/api/v1/ready` from inside web. Both are retried every 5 seconds while web starts and search prepares. Together they get `PR0_REDEPLOY_CHECK_SECONDS` from `.env` (whole seconds, 60–1800, default 600) |
| `backup` | `docker compose run --rm backup create`, labelled with the new release |
| `reopen-ingress` | Recreates the ingress on its new image and checks `/api/v1/ready` through it. If that fails, it stops the ingress again |

The script never runs `deletions initialize`, `restore …`, `accounts admit-first`, `down`, `rm` or any volume or image removal. It refuses such a command even if code asks for one.

**Output and records.** stdout carries one JSON event per line: `redeploy_started` (with the record path), `redeploy_step` per step with its duration, then `redeploy_complete` or `redeploy_failed`. Command output goes to stderr. The record `.deployments/<start>-<commit>.json` holds the previous and deployed commit, the image tags and image IDs, each step's start, duration and result, and every command run. Attach it to the candidate's evidence.

**When a step fails.** The `redeploy_failed` event names the failed step, the error, the ingress state (`open`, `closed` or `unknown`) and the action to take. If `preflight` fails, nothing has changed and ingress is still open: fix the cause (usually run `backup create`) and run the script again. After `close-ingress`, a failure leaves ingress stopped and the data intact. Before `recreate`, web and mail are stopped too; after it, they run the new release. If `reopen-ingress` fails, the script stops the ingress again. If even that fails, the state is `unknown`: run `docker compose stop ingress` and check `docker compose ps`. The checkout may already be at the new commit. If the failure came after `build`, `.env` names the new images. To recover:

- **Fix forward:** run the script again with a fixed commit. This is the normal path; preflight accepts the backup taken before the failed attempt while it is less than one hour old.
- **Go back to the previous commit** only if the current schema is still compatible with it: no migration ran, or `migrate` failed before applying anything (`docker compose run --rm accounts migrate` reports the current version). Run the script with the previous commit; its images are rebuilt from cache.
- Otherwise follow [disaster recovery](backup-restore.md#restore-sequence). Never run initialization to get past an error.

**When readiness stays `search_preparing`.** `/api/v1/ready` reports `search_preparing` until every account with edits has a current search projection. A projection is rebuilt only by that account's next search, and nobody else can search while ingress is closed. Waiting longer can't fix another account's stale projection. If `check` fails with `Readiness stayed unavailable` and the quoted body shows every other check `ready` and only `"search":"search_preparing"`, the new release is working. Finish the sequence by hand under the maintenance lock:

```sh
cd /opt/pr0
flock --wait 1800 /run/lock/pr0-maintenance.lock sh -c 'docker compose run --rm backup create && docker compose up --detach --no-build --no-deps --force-recreate --wait --wait-timeout 120 ingress'
curl --silent https://pr0.umami-creative.app/api/v1/ready
```

Each account's first search rebuilds its projection. Until the last one is current, `/api/v1/ready` answers 503 and `operations metrics` reports `readiness_unavailable`. The probe host alerts on that ([probe host](probe-host.md)). Acknowledge the alert and record the manual steps and the readiness body with the deployment record. It clears when readiness returns to `ready`. If any other check is unavailable, or the canary failed, don't reopen: fix forward as above. If the projection usually takes longer than the default wait to prepare, raise `PR0_REDEPLOY_CHECK_SECONDS` in `.env`.

Old image tags are kept for rollback and restore rehearsals. Remove a tag only after no backup within the 30-day retention names its release.

## Backup timer

[`pr0-backup.timer`](../../infrastructure/hosted/systemd/pr0-backup.timer) runs [`pr0-backup.service`](../../infrastructure/hosted/systemd/pr0-backup.service) at minutes 00 and 30 (UTC). Each run takes the maintenance lock (waiting up to 20 minutes while a redeploy holds it) and runs `docker compose run --rm backup create` in `/opt/pr0`. It then reports the real exit code to the dead-man's switch check `pr0-backup` with [`heartbeat.sh`](../../infrastructure/probe-host/heartbeat.sh) (`0` is success; anything else marks the check down at once). The unit exits with the backup's own code. A lock timeout counts as a failed backup, and a missed run alerts after the 15-minute grace ([probe host](probe-host.md#dead-mans-switch)).

```sh
install -d -m 700 /etc/pr0/credentials
install -m 600 /dev/null /etc/pr0/credentials/backup-heartbeat-url   # then write the check URL into it
cp /opt/pr0/infrastructure/hosted/systemd/pr0-backup.* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now pr0-backup.timer
systemctl start pr0-backup.service    # one run now; check the result below
systemctl status pr0-backup.service
journalctl -u pr0-backup.service -n 20 --no-pager
```

The check URL is a secret. It reaches the unit only through `LoadCredential` and goes to curl on stdin, never on a command line. Because `.env` carries the release identity, a backup after a redeploy uses the new tools image and release label automatically. `operations metrics` raises `backup_unavailable` when no verified backup is less than one hour old.

## Rehearse the script locally

`bun run --cwd apps/web test:hosted-redeploy` exercises the script end to end with Docker. It needs no prebuilt images, but its first build takes several minutes. The test:

1. Clones the repository's `HEAD` (or `PR0_HOSTED_FROM`) into `.scratch/` and adds three disposable commits: an ordinary candidate, a candidate with a failing migration, and its revert.
2. Performs the first deployment above with the hosted overlay. Local stand-ins replace the ledgers, SMTP and Coolify's network; the ingress port is published on loopback.
3. Redeploys to the candidate and checks every step, the record and the running images. It then redeploys the broken candidate: the script stops at `migrate` with ingress, web and mail stopped, the database running and the schema unchanged. Finally it fixes forward with the revert and checks that the account, instance and canary prompt are intact.

Set `PR0_HOSTED_EVIDENCE=<file>` to keep every run's events and records. The recorded run is [docs/evidence/issue-128-redeploy.json](../evidence/issue-128-redeploy.json). Cleanup removes only the test's randomly named project, its volumes, its proxy network and its image tags. A local run does not certify Coolify's Traefik, Let's Encrypt, the real ledgers or the Storage Box: check those on the server after the first deployment.
