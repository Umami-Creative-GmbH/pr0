# Run an independent pr0 instance

Build the web/API, mail worker and operator tools from one checked-out release. The official Windows desktop can connect to this instance at runtime; its executable updates continue to come from the independent official update channel. No registry images are published for the MVP. Use the annotated version tag of a released version, such as `v0.1.0` for the first MVP release (failed candidates use up their versions, so check the [GitHub Releases](https://github.com/Umami-Creative-GmbH/pr0/releases) for the actual number; see the [version policy](update-channel.md#version-policy)). Until then pin the exact candidate commit and retain its images. A GitHub source download is also usable if its release/commit identity is recorded.

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

Account deletion is a hard delete in the application database ([account deletion](account-deletion.md)). Each deletion writes an `account_deleted` line to web's standard output: keep those lines off this host for longer than your oldest restorable backup, because after a restore you re-apply them ([deletion log](account-deletion.md#the-deletion-log)).

Configure the [encrypted off-server backup mount and separately recoverable backup key](backup-restore.md#storage-and-recoverable-configuration). Set `PR0_BACKUP_MOUNT`, `PR0_BACKUP_KEY_PATH` and `PR0_BACKUP_RELEASE` (the exact source release and retained application image identity). Bind paths must already exist and be accessible to UID 1000. Scheduling, transport, key vault and storage vendor remain your choice. Test retrieval from another host.

## Build and initialize once

```sh
docker compose config --quiet
docker compose build
docker compose up -d database
docker compose run --rm accounts migrate
```

For the new, empty application instance:

```sh
docker compose run --rm restore initialize
docker compose run --rm accounts admit-first you@example.com
docker compose up -d web mail
docker compose ps
```

These are explicit one-shot operations; `up` does not run migrations or open a restore barrier. `restore initialize` refuses existing accounts/state. `admit-first` refuses another initial admission after an account/admission exists. It only admits the address: open the canonical origin, create the account with a 12–128-character password, follow the verification email and sign in. There is no shared bootstrap password or verification bypass.

`closed` permits only that first-account exception while no account exists. For subsequent invited users, set `PR0_REGISTRATION=allowlist`, run `docker compose run --rm accounts allow person@example.com`, and recreate web/mail. `open` admits any new address. The mode applies to all new-account paths, including OAuth; existing-account sign-in and recovery continue in closed mode. Use `accounts pause-registration`/`resume-registration` during known delivery outages without bypassing verification.

Create a prompt with a distinctive title and content such as `Hello {{name}}, count {{count|number}}`. Save, search for its distinctive text, copy it, enter values and confirm the clipboard contains the filled text while the saved template is unchanged. Copy history records use, never variable values. Reload and sign back in to check persistence.

## HTTPS, ingress and optional social login

The database has no published port and joins only the internal `database` network. Web, mail and jobs also join the default network for outbound SMTP and optional OAuth access. Search runs as at most two Bun workers inside the web service, with rebuildable SQLite projections on `search-data`; it has no network listener. Keep one web replica. PostgreSQL remains authoritative; do not delete canonical data to repair search.

A host reverse proxy can target the loopback published port. A container ingress can join this project's default network and target `web:3000`; it does not need the database network. Use your chosen trusted certificate/ingress. Permit the 25-second long poll (use a timeout above 30 seconds), disable indefinite response buffering, reject request compression and cap JSON bodies at 4 MiB before forwarding. Preserve Origin and method semantics; do not rewrite browser Origin to bypass CSRF protection. External direct backend access must remain blocked.

The server builds authentication/email links from `PR0_ORIGIN`, uses Secure/HttpOnly cookies on HTTPS and verifies browser origins. Only ingress that strips incoming `X-Pr0-Ingress-Secret` and `X-Pr0-Client-IP`, then writes its own configured secret and observed client IP, may provide rate-limit identity. Resolve explicitly trusted proxy chains at that boundary. Arbitrary `X-Forwarded-For`/Host headers are never identity. Without authenticated ingress, requests use a conservative shared IP bucket; configure ingress before admitting many users. Never expose token-bearing query strings, bodies, prompt content or variable values in ingress logs.

### Optional example ingress behind an edge proxy

`infrastructure/ingress` is an optional nginx image that implements these rules between an edge proxy, such as Coolify's Traefik, and `web:3000`. It is an example in the same style as the update-channel image, not a requirement: any ingress that meets the rules above works. It changes nothing in the application; it only supplies the authenticated `X-Pr0-Ingress-Secret`/`X-Pr0-Client-IP` boundary. Build it from the same checkout with `docker build -t pr0-ingress:my-release infrastructure/ingress`.

| Setting | Behavior |
| --- | --- |
| `PR0_INGRESS_SECRET_FILE` (or `PR0_INGRESS_SECRET`) | The same value as the web service's `PR0_INGRESS_SECRET`; at least 32 characters of `A-Z a-z 0-9 . _ ~ + / = -`, e.g. `openssl rand -hex 32`. The file wins, as for the application |
| `PR0_INGRESS_TRUSTED_PROXIES` | Required. Comma- or space-separated addresses/CIDRs of the edge proxy. Only peers in this list may supply `X-Forwarded-For` |
| `PR0_INGRESS_METRICS_ALLOW` | Optional probe addresses/CIDRs allowed to reach `/api/v1/operations/`. Empty refuses everyone |
| `PR0_INGRESS_UPSTREAM` | `web:3000` by default |
| `PR0_INGRESS_RESOLVER` | Docker's embedded DNS `127.0.0.11` by default, so a recreated web container is found again |

The container starts only with a valid secret and trusted-proxy list. It runs as the image's `nginx` user, listens on port 8080 and declares a Docker health check on an internal loopback-only port. Its behavior:

- Real-IP information is accepted only from `PR0_INGRESS_TRUSTED_PROXIES`. `X-Forwarded-For` is walked right to left, skipping trusted proxies, so entries a client prepended are never used. Any other peer is attributed by its socket address.
- `X-Pr0-Ingress-Secret` and `X-Pr0-Client-IP` are always overwritten with the configured secret and the resolved client. `X-Forwarded-For` is replaced by that client. Incoming `X-Real-IP`, `Forwarded` and the application's internal `X-Pr0-*` headers are dropped. The application then forms IPv4 /32 and IPv6 /64 buckets.
- Bodies above 4 MiB get 413 and any `Content-Encoding` other than `identity` gets 415, before reaching the application. Upstream reads allow 60 seconds, which covers the 25-second long poll, and response buffering is off.
- `/api/v1/operations/` answers 404 unless the resolved client is in `PR0_INGRESS_METRICS_ALLOW`. The application still requires the metrics bearer secret.
- **Redaction:** the access log is one JSON line per request with time, client address, method, path without query string, status, bytes, duration and upstream status. It never contains `Authorization`, cookies, bodies or query strings. nginx's error log embeds request lines, including query strings, so it is limited to process-level alerts; use the access log's status and upstream status to diagnose requests.

Behind Coolify's Traefik, run the ingress as a service of the same Compose project, attach it to the project's default network and to Coolify's proxy network (`coolify` by default), and route the instance's domain to the ingress on port 8080 instead of to `web`. Set `PR0_INGRESS_TRUSTED_PROXIES` to that network's subnet (`docker network inspect coolify --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'`). Every container on that network can then supply forwarded headers, so attach only trusted services to it, or use Traefik's own address if you pin it. Traefik records the peer it sees in `X-Forwarded-For`, which the ingress resolves. If a CDN or another proxy sits in front of Traefik, also list its published address ranges, otherwise every client is attributed to that proxy. Set `PR0_INGRESS_METRICS_ALLOW` to the probe host's public address as Traefik sees it. Remove the web service's published port, or keep it on loopback, so the ingress is the only public path. Use `/api/v1/health` through the ingress for Coolify's HTTP health check. A minimal overlay:

```yaml
services:
  ingress:
    image: pr0-ingress:my-release
    build: infrastructure/ingress
    environment:
      PR0_INGRESS_SECRET_FILE: /run/secrets/PR0_INGRESS_SECRET
      PR0_INGRESS_TRUSTED_PROXIES: 10.0.1.0/24
      PR0_INGRESS_METRICS_ALLOW: 203.0.113.7
    secrets: [PR0_INGRESS_SECRET]
    networks: [default, edge]
    restart: unless-stopped
    depends_on: [web]
networks:
  edge:
    external: true
    name: coolify
```

The hosted service runs the stack as a Coolify Compose application with a separate Coolify-managed PostgreSQL 17 database: [`compose.coolify.yaml`](../../compose.coolify.yaml), with the ingress in front of web, the upgrade sequence as one-shot jobs and every setting as a runtime environment variable. Coolify generates the routing labels and attaches its proxy to the application's network. It is one way to deploy pr0, not a requirement. The `NAME_FILE` secret files above remain supported. See [the hosted runbook](hosted.md).

Rotate the ingress secret by replacing the file and recreating `ingress` and `web` together; during the gap, clients fall back to the shared `untrusted` bucket. `bun run --cwd apps/web test:ingress` exercises the image through the self-hosting fixture (see [service health](service-health.md#trusted-ingress)).

To enable Google or GitHub, register your own provider application and configure its client ID and secret (or `_FILE`). Exact callbacks are:

```text
https://<instance-host>/api/auth/callback/google
https://<instance-host>/api/auth/callback/github
```

Keep development and production provider apps separate; request the identity/email permissions documented in [social login](../social-login.md). Mount optional secret files into the consumers, including backup/configuration jobs. Omit client IDs to disable providers: the sign-in options disappear and direct attempts fail. Linking methods is explicit; equal email addresses never merge accounts, including across instances. Test real provider consent/login and delivered email with your actual configuration before enabling them publicly.

## Connect the Windows desktop

Install the official Windows application from the official download channel, then select this instance's **HTTPS** origin in the app before sign-in. The user's Windows certificate store must trust its certificate, including any private CA: the desktop validates instance certificates with Windows (certificate store, revocation and enterprise policy), not a bundled root list. For a private CA, install its root in the Windows **Trusted Root Certification Authorities** store (per user, or machine-wide via policy) on each desktop; if the browser on that machine trusts the instance, the desktop does too. If Windows does not trust the certificate, the app shows **Untrusted certificate** (distinct from Offline), sends nothing and keeps local work and pending changes until the certificate is trusted. Never disable certificate verification. Accepting roots that Windows trusts is a compatibility commitment ([ADR-0003](../adr/0003-desktop-trusts-the-windows-certificate-store.md)): later releases will not narrow it to public roots, so a private-CA deployment keeps working across updates. Start sign-in, check the instance and matching code in the opened browser, sign in with verified email and approve that code. Return to the app and let it download the library.

Disconnect the instance/network, reopen a downloaded prompt, edit it and copy a filled template from the library/launcher. Reconnect; verify pending edits and usage synchronize and the web sees the exact retained text. Filled values must not become template text or upload payloads. Before switching accounts/instances, follow sign-out's pending-work safeguards; retain/export work when instructed. Reauthenticate to the retained identity when a session expires.

For isolation acceptance, initialize another independent instance, register and verify the **same email**, then switch to that HTTPS origin and approve it. Its instance/account identities and library must differ; the original library must not appear or receive this instance's edits. Switch back through the same safeguards to confirm the original library remains intact. Instance selection changes API/session identity only. It cannot change the official update endpoint or updater signing key. Custom desktop forks own their own signing/distribution; never trust executable updates supplied by a selected instance.

## Readiness and maintenance

`GET /api/v1/health` is liveness. `GET /api/v1/ready` must return 200 only after compatible schema, recent mail-worker heartbeat and current search projections are usable. Missing/malformed restore state fails closed. Search catch-up can return 503 `search_preparing` with retry guidance; retry the actual search and retain client work. Container startup order and `pg_isready` alone are insufficient.

```sh
docker compose logs --tail=50 web mail
docker compose run --rm accounts mail-status
docker compose run --rm operations sample-storage database /var/lib/postgresql/data
docker compose run --rm operations sample-storage search /var/lib/pr0-search
docker compose run --rm operations metrics
docker compose run --rm backup create
```

Metrics exits nonzero when alerts exist; missing off-server backup capacity observations and overdue backups intentionally alert. Sample those actual filesystems at their hosts, not a container root disk. Connect [private metrics, storage alerts and an external authenticated library/search probe](service-health.md) to your chosen monitoring. Sample at least once per minute, expand storage at 70% before 80%, and verify backup checkpoints within one hour. Schedule a verified backup every 30 minutes and finish each cycle within 30 minutes, or demonstrate an equivalent recoverable WAL-based plan. Ordinary backups expire within 30 days including every hidden storage version; keep the deletion log longer than that.

Ordinary lifecycle commands retain named volumes:

```sh
docker compose restart web mail
docker compose up -d --build web mail
docker compose down
docker compose up -d database web mail
```

Use the same project name (`-p` or `COMPOSE_PROJECT_NAME`) and configuration each time. Renaming the project selects different volumes; it does not migrate the old data. **`docker compose down --volumes` / `down -v` destroys named volumes**, including the canonical library, instance identity, recovery checkpoint and migration backups. `docker volume rm` and volume pruning can also destroy them. Never use these for routine repair or upgrade.

## Upgrade and recover

Read release notes for schema/protocol/normalization/configuration changes and tested platforms. Retain the old source/images and use compatible desktop releases from the preceding 90 days. Incompatible clients retain offline data and pending edits and must upgrade before uploading; a newer desktop must also negotiate safely with an older server.

For an ordinary version upgrade: verify a fresh recoverable backup and enough database/tooling scratch capacity (at least three times database size plus 16 MiB for current backup tooling), close public ingress and drain/stop web/mail and scheduled writers, then check out the intended release. Give its app/tools distinct matching tags in `.env`, build both, and run **one** `docker compose run --rm accounts migrate`. The coordinator locks and verifies recorded migration checksums. Replace web/mail using `docker compose up -d --force-recreate web mail`, run authenticated library/search checks and readiness, create a verified backup labelled with the new release, then reopen ingress. Preserve every named volume and existing secrets/identity. This maintenance drain does not reset the recovery epoch. A failed migration keeps ingress closed and data intact; only roll back to a binary compatible with the resulting schema. Otherwise use disaster recovery.

For database/host loss or an incompatible rollback, follow the complete [restore sequence](backup-restore.md#restore-sequence): fence every previous writer and close admission; recover immutable instance/configuration/keys and the deletion log; restore a verified compatible ordinary archive to an empty database; re-apply the deletion log with `deletions reapply`; rotate auth credentials; `restore prepare` invalidates restored credentials, establishes a new epoch and rebuilds search. Start replacement web/mail behind closed ingress, verify a fresh backup, and use `restore open` before reopening ingress. Without the re-delete step, accounts deleted after the restored backup come back. Never run initialization to bypass recovery.

Returning desktops reauthenticate, retain pending edits and recoverable acknowledged rows newer than the checkpoint, and do not automatically upload every old row. Only the instance's `deleted` answer for exactly the retained account authorizes deleted-account cleanup. Rehearse a deletion newer than the database backup, its re-deletion from the log and interrupted restoration before public use and quarterly. Retain measured actual loss/recovery times and off-server/key-retrieval evidence. A local Compose rehearsal does not certify independent failure domains, a full-capacity workload, a signed installed Windows release, or an operator's email/TLS services.

## Repeat the disposable acceptance journey

From the root checkout, build matching test images and run the isolated fixture:

```sh
docker build --target runtime -t pr0-self-host-62 .
docker build --target migration-runtime -t pr0-self-host-tools-62 .
bun run --cwd apps/web test:self-hosting
# Windows with Rust/MSVC and Edge: also exercise the real native command worker.
bun run --cwd apps/web test:self-hosting native --evidence=docs/evidence/issue-62-local.json
```

The runner generates unique Compose project names, ports, credentials and secret files beneath `.scratch/`. It uses the root production Compose file plus a disposable SMTP override, real production images, public REST, served browser UI, and optional typed Rust commands/Windows Credential Manager/clipboard. It checks verified signup, disabled social options, prompt create/search/variable copy, restart/down/up preservation, migration 20→21 with failed preflight, same-email instance isolation, and encrypted recovery after a later acknowledged deletion, re-applied from the web container's log. The native mode also checks HTTPS selection/browser approval, a restarted offline process, exact variable copy, offline edit/reconnect and switching away/back. Cleanup removes volumes **only from its own randomly named disposable projects**. Never point this fixture at an existing instance or real storage.

`PR0_SELF_HOST_IMAGE` and `PR0_SELF_HOST_TOOLS_IMAGE` select alternate already-built test tags. `PR0_SELF_HOST_PLATFORM=linux/arm64` forces all fixture services to ARM64; build both targets with `--platform linux/arm64` first and use a host with native or working emulated execution. The evidence records actual execution architecture, runtime/tool versions and recovery timings. ARM64 builds and local synthetic storage are distinct from native ARM hardware and operator host-loss certification. `PR0_TEST_BROWSER` can select another installed Chromium channel.
