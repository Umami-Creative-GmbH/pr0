# Hosted variable inventory (Phase)

Every variable that [`compose.coolify.yaml`](../../compose.coolify.yaml) reads is listed here once, with its Phase type. Phase (self-hosted) is the source of truth. Its Coolify integration syncs the hosted environment to the pr0 Coolify application ([hosted runbook](hosted.md), [ADR-0004](../adr/0004-coolify-runs-the-hosted-stack-with-phase-as-config-source.md)). `apps/web/tests/hosted-deploy.test.ts` fails when this table and the Compose file disagree.

- **Phase type** `config` is stored unencrypted in Phase. Use it only for values that may appear in a screenshot or a log. `secret` is encrypted. Use `secret` rather than `sealed` for every secret until a sync has shown that Phase can push sealed values to Coolify.
- **In Coolify**, every `secret` row must be **runtime-only**: clear **Available during build** on the variable. Coolify enables it by default for new variables. No Dockerfile in this repository declares an `ARG`, so a mis-flagged variable still can't land in an image layer, but it would reach the build log's environment. Check the flag after every sync that adds a variable.
- **Required** means the Compose file uses `${NAME:?…}`, so Coolify refuses to deploy while it's empty.
- The sync is one-way and **deletes Coolify variables that aren't in Phase**. Never edit the variables in Coolify. A change made there is lost on the next sync.
- A sync **doesn't redeploy**. A changed value applies on the next Coolify deployment.

| Key | Phase type | Required | Value |
| --- | --- | --- | --- |
| `PR0_ORIGIN` | config | yes | `https://pr0.umami-creative.app` |
| `PR0_REGISTRATION` | config | yes | `allowlist` until the [release act](release-act.md#open-registration), then `open` |
| `PR0_IMPRESSUM_URL` | config | yes | The operator's Impressum (absolute HTTPS URL) |
| `PR0_PRIVACY_URL` | config | yes | The privacy policy (absolute HTTPS URL) |
| `PR0_TERMS_URL` | config | yes | The terms (absolute HTTPS URL) |
| `PR0_GOOGLE_CLIENT_ID` | config | no | Production Google OAuth client ID; empty disables Google sign-in |
| `PR0_GITHUB_CLIENT_ID` | config | no | Production GitHub OAuth app client ID; empty disables GitHub sign-in |
| `API_ALLOWED_ORIGINS` | config | no | Extra CORS origins; normally empty |
| `SMTP_HOST` | config | yes | `smtp-relay.brevo.com` |
| `SMTP_PORT` | config | no | `587` (default) |
| `SMTP_TLS` | config | no | `starttls` (default) |
| `SMTP_USER` | config | no | Brevo SMTP login |
| `SMTP_FROM` | config | yes | `no-reply@umami-creative.app` |
| `PR0_INGRESS_TRUSTED_PROXIES` | config | yes | Subnet of the network that Coolify's proxy shares with the ingress ([hosted runbook](hosted.md#routing-and-the-ingress)) |
| `PR0_INGRESS_METRICS_ALLOW` | config | no | The probe host's public address as Traefik sees it ([probe host](probe-host.md)) |
| `PR0_BACKUP_MOUNT` | config | yes | `/mnt/pr0-backups`, the Storage Box mount on the Coolify server, owned by UID 1000 |
| `PR0_IMAGE_NAME` | config | no | Leave unset (image names `pr0`, `pr0-tools`, `pr0-ingress`). The local deploy test sets it |
| `POSTGRES_PASSWORD` | secret | yes | Strong application database password |
| `DATABASE_URL` | secret | yes | `postgres://pr0:<URL-encoded POSTGRES_PASSWORD>@database:5432/pr0` |
| `BETTER_AUTH_SECRET` | secret | yes | Random, at least 32 characters. Never rotate it casually: rotation is part of [restore](backup-restore.md#restore-sequence) |
| `PR0_MAIL_SECRET` | secret | yes | Random, at least 32 characters, independent of the above |
| `PR0_LEDGER_A_URL` | secret | yes | Ledger A **runtime** (append-only) role, `postgres://<role>:<password>@<host>:5432/<db>?sslmode=verify-full`. The administrative URL never goes into Phase ([first deployment](hosted.md#first-deployment)) |
| `PR0_LEDGER_B_URL` | secret | yes | Ledger B runtime role, as above |
| `PR0_INGRESS_SECRET` | secret | yes | `openssl rand -hex 32`. Web and ingress read the same value |
| `PR0_METRICS_SECRET` | secret | yes | `openssl rand -hex 32`, also on the probe host |
| `PR0_GOOGLE_CLIENT_SECRET` | secret | no | Production Google OAuth client secret |
| `PR0_GITHUB_CLIENT_SECRET` | secret | no | Production GitHub OAuth app secret |
| `SMTP_PASSWORD` | secret | no | Brevo SMTP key (required in practice: mail fails without it) |
| `PR0_BACKUP_KEY` | secret | yes | 32 random bytes as lowercase hex (`openssl rand -hex 32`). The vault keeps the authoritative copy: without it no backup can be restored |
| `PR0_BACKUP_HEARTBEAT_URL` | secret | yes | The dead-man's switch check URL for `pr0-backup` ([probe host](probe-host.md#dead-mans-switch)) |

Not in Phase:

- `SOURCE_COMMIT` is set by Coolify to the deployed commit when **Include Source Commit in Build** is on. The Compose file requires it: it names the images (`pr0:<commit>`) and the release label (`pr0@<commit>`).
- Coolify's own generated variables (`SERVICE_FQDN_*`, `COOLIFY_*`) aren't used.
- The probe host's variables and the canary cookie stay on the probe host ([probe host](probe-host.md)).
