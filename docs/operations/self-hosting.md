# Run an independent pr0 instance

Build the web/API, mail worker and operator tools from one checked-out release. The official Windows desktop can connect to this instance at runtime; its executable updates continue to come from the independent official update channel. No registry images are published for the MVP. Use the annotated `v0.1.0` tag once released; until then pin the exact candidate commit and retain its images. A GitHub source download is also usable if its release/commit identity is recorded.

You choose the host, domain, trusted HTTPS ingress, SMTP service, backup destination, monitoring and resource allocation. The 2-vCPU/4-GiB/64-GiB workload benchmark is a validation fixture, not a minimum or purchase requirement. Current measured platforms, exact versions and limitations are in [the self-hosting validation report](self-hosting-validation.md). A multi-platform image manifest alone does not establish successful execution.

## Prepare configuration and storage

Install Docker Engine with the Compose plugin (Linux containers). Source development additionally requires Bun; the container build installs locked dependencies and carries its own pinned Bun runtime. From a clean checkout:

```sh
cp .env.example .env
cp compose.secrets.example.yaml compose.override.yaml
mkdir -m 700 .secrets
```

On Windows use the equivalent file-copy and restricted-directory commands. `.env`, `.secrets/`, `backups/` and `compose.override.yaml` are excluded from Git; secret/configuration directories are also excluded from the build context. Keep actual backup storage outside the checkout.

Populate the secret files named in `compose.override.yaml` using a private editor or secret manager. Set the corresponding `NAME_FILE` entries in `.env` and leave the plaintext values empty. The example mounts server secrets into the operational jobs as well as web/mail so migration, diagnostics and backup configuration export see the same effective settings. Remove optional secret declarations/mounts when unused; do not point `_FILE` at an absent or empty file. For unauthenticated local SMTP, omit its password mount and `_FILE` entry.

| Setting | Required configuration |
| --- | --- |
| `POSTGRES_PASSWORD_FILE` | Strong database password; the database container alone receives this file |
| `DATABASE_URL_FILE` | `postgres://pr0:<URL-encoded-password>@database:5432/pr0`, matching that password |
| `BETTER_AUTH_SECRET_FILE`, `PR0_MAIL_SECRET_FILE` | Independent random values, at least 32 characters; preserve them through ordinary restarts/upgrades |
| `PR0_LEDGER_A_URL_FILE`, `PR0_LEDGER_B_URL_FILE` | Two independent PostgreSQL 17 deletion stores, described below |
| `SMTP_PASSWORD_FILE` | SMTP credential if the service requires one |
| `PR0_INGRESS_SECRET_FILE` | High-entropy shared secret for authenticated ingress IP attribution, if configured |
| `PR0_METRICS_SECRET_FILE` | High-entropy secret for private operational metrics |

Secret files must be readable by the actual container identities: Bun services use UID 1000; migration tooling and PostgreSQL use their image's `postgres` user. Compose file secrets use bind mounts, so do not assume Compose `uid`/`mode` remaps host permissions. One local arrangement is a host directory accessible only to its operator (0700), with read-only files readable by the consuming container UIDs (0444 inside that protected directory). Restrict equivalent Windows ACLs. Never publish the directory or bake it into an image. Preserve protected copies and keys independently of this host. Normal non-secret settings belong in `.env`:

| Setting | Behavior |
| --- | --- |
| `PR0_IMAGE`, `PR0_TOOLS_IMAGE` | Distinct local image tags from the same source, e.g. `pr0:my-release` and `pr0-tools:my-release` |
| `PR0_ORIGIN` | One canonical web/API origin, e.g. `https://prompts.example.org`; no path, query, fragment or credentials |
| `PR0_BIND_ADDRESS`, `PR0_PORT` | Defaults to `127.0.0.1:3000`; publish only to your trusted ingress |
| `PR0_REGISTRATION` | `closed` by default; also `allowlist` or `open` |
| `PR0_IMPRESSUM_URL`, `PR0_PRIVACY_URL`, `PR0_TERMS_URL` | Optional absolute HTTPS URLs (no credentials, at most 2048 characters) of your Impressum, privacy policy and terms of use. Configured links appear on web sign-in, sign-up and the app footer, and desktops receive them through negotiated discovery. Empty settings hide the link; pr0 has no built-in defaults. Invalid values stop the web server at startup. Recreate web after changing them. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_FROM` | Verified sender and SMTP endpoint; `starttls` requires STARTTLS (usually 587), `tls` uses implicit TLS (usually 465) |
| `SMTP_USER` | Optional SMTP login name |

HTTP and `SMTP_TLS=plain` are allowed only with a loopback HTTP canonical origin for local evaluation. Production account access and desktop connections require trusted HTTPS. Email/password works without either social provider. Verification and recovery still require working SMTP; SMTP acceptance is not proof of inbox delivery.

Provide **two deletion-ledger PostgreSQL databases on independent durable hosts/storage failure domains**, separate from the application database and each other. They are operator services, not two extra volumes on the application host. Follow [the ledger initialization, restricted runtime grants and retention requirements](account-deletion.md#independent-storage-configuration). Initially supply administrative ledger URLs only to initialization; then replace them with the restricted append-only runtime URLs before starting web/mail. Retain their store identities, private signing anchor and complete key-rotation history indefinitely. Both stores must acknowledge durable writes. Never include either in an ordinary database rollback. Local acceptance containers exercise this protocol but do not establish host-loss durability.

Configure the [encrypted off-server backup mount and separately recoverable backup key](backup-restore.md#storage-and-recoverable-configuration). Set `PR0_BACKUP_MOUNT`, `PR0_BACKUP_KEY_PATH` and `PR0_BACKUP_RELEASE` (the exact source release and retained application image identity). Bind paths must already exist and be accessible to UID 1000. Scheduling, transport, key vault and storage vendor remain your choice. Test retrieval from another host.

## Build and initialize once

```sh
docker compose config --quiet
docker compose build
docker compose up -d database
docker compose run --rm accounts migrate
docker compose run --rm deletions initialize
```

Switch ledger URLs to the restricted runtime roles now. For the new, empty application instance:

```sh
docker compose run --rm restore initialize
docker compose run --rm accounts admit-first you@example.com
docker compose up -d web mail
docker compose ps
```

These are explicit one-shot operations; `up` does not run migrations, manufacture trust material or open a restore barrier. `restore initialize` refuses existing accounts/state. `admit-first` refuses another initial admission after an account/admission exists. It only admits the address: open the canonical origin, create the account with a 12–128-character password, follow the verification email and sign in. There is no shared bootstrap password or verification bypass.

`closed` permits only that first-account exception while no account exists. For subsequent invited users, set `PR0_REGISTRATION=allowlist`, run `docker compose run --rm accounts allow person@example.com`, and recreate web/mail. `open` admits any new address. The mode applies to all new-account paths, including OAuth; existing-account sign-in and recovery continue in closed mode. Use `accounts pause-registration`/`resume-registration` during known delivery outages without bypassing verification.

Create a prompt with a distinctive title and content such as `Hello {{name}}, count {{count|number}}`. Save, search for its distinctive text, copy it, enter values and confirm the clipboard contains the filled text while the saved template is unchanged. Copy history records use, never variable values. Reload and sign back in to check persistence.

## HTTPS, ingress and optional social login

The database has no published port and joins only the internal `database` network. Web, mail and jobs also join the default network for outbound SMTP, ledger and optional OAuth access. Search runs as at most two Bun workers inside the web service, with rebuildable SQLite projections on `search-data`; it has no network listener. Keep one web replica. PostgreSQL remains authoritative; do not delete canonical data to repair search.

A host reverse proxy can target the loopback published port. A container ingress can join this project's default network and target `web:3000`; it does not need the database network. Use your chosen trusted certificate/ingress. Permit the 25-second long poll (use a timeout above 30 seconds), disable indefinite response buffering, reject request compression and cap JSON bodies at 4 MiB before forwarding. Preserve Origin and method semantics; do not rewrite browser Origin to bypass CSRF protection. External direct backend access must remain blocked.

The server builds authentication/email links from `PR0_ORIGIN`, uses Secure/HttpOnly cookies on HTTPS and verifies browser origins. Only ingress that strips incoming `X-Pr0-Ingress-Secret` and `X-Pr0-Client-IP`, then writes its own configured secret and observed client IP, may provide rate-limit identity. Resolve explicitly trusted proxy chains at that boundary. Arbitrary `X-Forwarded-For`/Host headers are never identity. Without authenticated ingress, requests use a conservative shared IP bucket; configure ingress before admitting many users. Never expose token-bearing query strings, bodies, prompt content or variable values in ingress logs.

To enable Google or GitHub, register your own provider application and configure its client ID and secret (or `_FILE`). Exact callbacks are:

```text
https://<instance-host>/api/auth/callback/google
https://<instance-host>/api/auth/callback/github
```

Keep development and production provider apps separate; request the identity/email permissions documented in [social login](../social-login.md). Mount optional secret files into the consumers, including backup/configuration jobs. Omit client IDs to disable providers: the sign-in options disappear and direct attempts fail. Linking methods is explicit; equal email addresses never merge accounts, including across instances. Test real provider consent/login and delivered email with your actual configuration before enabling them publicly.

## Connect the Windows desktop

Install the official Windows application from the official download channel, then select this instance's **HTTPS** origin in the app before sign-in. The user's Windows certificate store must trust its certificate, including any private CA. Never disable certificate verification. Start sign-in, check the instance and matching code in the opened browser, sign in with verified email and approve that code. Return to the app and let it download the library.

Disconnect the instance/network, reopen a downloaded prompt, edit it and copy a filled template from the library/launcher. Reconnect; verify pending edits and usage synchronize and the web sees the exact retained text. Filled values must not become template text or upload payloads. Before switching accounts/instances, follow sign-out's pending-work safeguards; retain/export work when instructed. Reauthenticate to the retained identity when a session expires.

For isolation acceptance, initialize another independent instance, register and verify the **same email**, then switch to that HTTPS origin and approve it. Its instance/account identities and library must differ; the original library must not appear or receive this instance's edits. Switch back through the same safeguards to confirm the original library remains intact. Instance selection changes API/session identity only. It cannot change the official update endpoint or updater signing key. Custom desktop forks own their own signing/distribution; never trust executable updates supplied by a selected instance.

## Readiness and maintenance

`GET /api/v1/health` is liveness. `GET /api/v1/ready` must return 200 only after compatible schema, deletion replay/ledger access, recent mail-worker heartbeat and current search projections are usable. Missing/malformed restore state fails closed. Search catch-up can return 503 `search_preparing` with retry guidance; retry the actual search and retain client work. Container startup order and `pg_isready` alone are insufficient.

```sh
docker compose logs --tail=50 web mail
docker compose run --rm accounts mail-status
docker compose run --rm operations sample-storage database /var/lib/postgresql/data
docker compose run --rm operations sample-storage search /var/lib/pr0-search
docker compose run --rm operations metrics
docker compose run --rm backup create
```

Metrics exits nonzero when alerts exist; missing off-server ledger/backup capacity observations and overdue backups intentionally alert. Sample those actual filesystems at their hosts, not a container root disk. Connect [private metrics, storage alerts and an external authenticated library/search probe](service-health.md) to your chosen monitoring. Sample at least once per minute, expand storage at 70% before 80%, and verify backup checkpoints within one hour. Schedule a verified backup every 30 minutes and finish each cycle within 30 minutes, or demonstrate an equivalent recoverable WAL-based plan. Ordinary backups expire within 30 days including every hidden storage version; deletion evidence does not expire.

Ordinary lifecycle commands retain named volumes:

```sh
docker compose restart web mail
docker compose up -d --build web mail
docker compose down
docker compose up -d database web mail
```

Use the same project name (`-p` or `COMPOSE_PROJECT_NAME`) and configuration each time. Renaming the project selects different volumes; it does not migrate the old data. **`docker compose down --volumes` / `down -v` destroys named volumes**, including the canonical library, instance identity, recovery checkpoint and migration backups. `docker volume rm` and volume pruning can also destroy them. Never use these for routine repair or upgrade. External deletion-ledger history must remain independently protected even when a disposable application instance is removed.

## Upgrade and recover

Read release notes for schema/protocol/normalization/configuration changes and tested platforms. Retain the old source/images and use compatible desktop releases from the preceding 90 days. Incompatible clients retain offline data and pending edits and must upgrade before uploading; a newer desktop must also negotiate safely with an older server.

For an ordinary version upgrade: verify a fresh recoverable backup and enough database/tooling scratch capacity (at least three times database size plus 16 MiB for current backup tooling), close public ingress and drain/stop web/mail and scheduled writers, then check out the intended release. Give its app/tools distinct matching tags in `.env`, build both, and run **one** `docker compose run --rm accounts migrate`. The coordinator locks and verifies recorded migration checksums. Reapply `deletions replay`, replace web/mail using `docker compose up -d --force-recreate web mail`, run authenticated library/search checks and readiness, create a verified backup labelled with the new release, then reopen ingress. Preserve every named volume and existing secrets/identity. This maintenance drain does not reset the recovery epoch. A failed migration keeps ingress closed and data intact; only roll back to a binary compatible with the resulting schema. Otherwise use disaster recovery.

For database/host loss or an incompatible rollback, follow the complete [deletion-safe restore sequence](backup-restore.md#restore-sequence): fence every previous writer and close admission; recover immutable instance/configuration/keys and authoritative independent ledgers; seal a complete external evidence checkpoint; restore a verified compatible ordinary archive to an empty database; rotate auth credentials; `restore prepare` invalidates restored credentials, replays deletions, establishes a new epoch and rebuilds search. Start replacement web/mail behind closed ingress, verify a fresh backup, and use `restore open` before reopening ingress. Unavailable, behind or uncertain deletion evidence keeps the barrier closed. Never run initialization to bypass recovery.

Returning desktops reauthenticate, retain pending edits and recoverable acknowledged rows newer than the checkpoint, and do not automatically upload every old row. Only a signed receipt matching the pinned instance/account authorizes deleted-account cleanup. Rehearse a deletion newer than the database backup, signing-key rotation, unavailable/incomplete ledgers and interrupted restoration before public use and quarterly. Retain measured actual loss/recovery times and off-server/key-retrieval evidence. A local Compose rehearsal does not certify independent failure domains, a full-capacity workload, a signed installed Windows release, or an operator's email/TLS services.

## Repeat the disposable acceptance journey

From the root checkout, build matching test images and run the isolated fixture:

```sh
docker build --target runtime -t pr0-self-host-62 .
docker build --target migration-runtime -t pr0-self-host-tools-62 .
bun run --cwd apps/web test:self-hosting
# Windows with Rust/MSVC and Edge: also exercise the real native command worker.
bun run --cwd apps/web test:self-hosting native --evidence=docs/evidence/issue-62-local.json
```

The runner generates unique Compose project names, ports, credentials and secret files beneath `.scratch/`. It uses the root production Compose file plus a disposable SMTP/ledger override, real production images, public REST, served browser UI, and optional typed Rust commands/Windows Credential Manager/clipboard. It checks verified signup, disabled social options, prompt create/search/variable copy, restart/down/up preservation, migration 19→20 with failed preflight, same-email instance isolation, and encrypted recovery after a later acknowledged deletion/key rotation. The native mode also checks HTTPS selection/browser approval, a restarted offline process, exact variable copy, offline edit/reconnect and switching away/back. Cleanup removes volumes **only from its own randomly named disposable projects**. Never point this fixture at an existing instance or real storage.

`PR0_SELF_HOST_IMAGE` and `PR0_SELF_HOST_TOOLS_IMAGE` select alternate already-built test tags. `PR0_SELF_HOST_PLATFORM=linux/arm64` forces all fixture services to ARM64; build both targets with `--platform linux/arm64` first and use a host with native or working emulated execution. The evidence records actual execution architecture, runtime/tool versions and recovery timings. ARM64 builds and local synthetic storage are distinct from native ARM hardware and operator host-loss certification. `PR0_TEST_BROWSER` can select another installed Chromium channel.
