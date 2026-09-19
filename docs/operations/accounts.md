# Deploy the web account slice

Issue #24 supplies email/password registration, verification, sign-in, an empty private library, account/instance display, and sign-out when there is no pending work. Prompt editing and native account sessions are subsequent slices. `/prototype/library` remains a separate throwaway demonstration with synthetic data.

The web server uses Better Auth 1.7.5, its Drizzle adapter 1.7.5 with transactions enabled, Drizzle 0.45.2, and Bun SQL. PostgreSQL 17.10 holds accounts, sessions, library ownership, registration admission, request admission, the encrypted email outbox, and immutable instance identity. There is no Redis dependency. The mail worker and operational commands also run under Bun as a non-root container user.

## Initialize a local instance

1. Copy `.env.example` to `.env`. Supply a strong PostgreSQL password, the matching URL-encoded password in `DATABASE_URL`, and independent random `BETTER_AUTH_SECRET` and `PR0_MAIL_SECRET` values of at least 32 characters. Keep these values outside Git. Changing the auth secret invalidates cookies and pending verification tokens; changing the mail secret makes queued mail unreadable. Preserve both across ordinary recreation.
2. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and optional `SMTP_USER`/`SMTP_PASSWORD`. Use `SMTP_TLS=starttls` (required STARTTLS, normally port 587) or `tls` (implicit TLS, normally port 465). `plain` is permitted only with a loopback HTTP canonical origin for local evaluation. The sender must be accepted by your SMTP service. SMTP acceptance does not prove inbox delivery.
3. Set `PR0_ORIGIN` to the one canonical web/API origin. `http://localhost:3000` is suitable for local evaluation; externally reachable operation requires HTTPS. Links are constructed from this configured origin, never forwarded Host headers. Keep the published interface at `127.0.0.1` behind a host proxy; a container proxy can use the private Compose network and `web:3000`.
4. Build, migrate explicitly, and admit the first address:

```sh
docker compose build
docker compose up -d database
docker compose run --rm accounts migrate
docker compose run --rm accounts admit-first you@example.com
docker compose up -d web mail
```

Open the configured origin, choose Create a new account, register with the admitted email and a 12–128-character password, follow the email link, then sign in. Admission never creates a shared bootstrap password or bypasses verification. The first-account command refuses a second initial admission once an admission or account exists. Closed mode ignores general allowlist entries; its explicit first-account exception applies only while the instance has no account.

Self-hosting defaults to `PR0_REGISTRATION=closed`. `open` permits registration by any address. In `allowlist` mode, add an address using `docker compose run --rm accounts allow person@example.com`; non-admitted addresses remain refused. The `allow` command requires allowlist mode. After changing runtime configuration, recreate web/mail with `docker compose up -d web mail`. Existing account sign-in continues when registration is closed.

The named `postgres-data` volume retains all account state and instance identity through `docker compose down`, restarts, image replacement, and migration reapplication. `docker compose down --volumes` destroys it. Migrations take an exclusive PostgreSQL coordinator lock and verify the checksums of applied migrations; a changed checksum stops the command. Do not edit an applied migration. Apply new migrations using the matching image before exposing that image to traffic. A missing or incompatible schema keeps readiness closed.

## Mounted secrets

`DATABASE_URL`, `BETTER_AUTH_SECRET`, `PR0_MAIL_SECRET`, `PR0_INGRESS_SECRET`, and `SMTP_PASSWORD` support corresponding `_FILE` variables. PostgreSQL supports `POSTGRES_PASSWORD_FILE`. Secret files override environment values and are read only on the server. Mount them in a local Compose override, for example:

```yaml
services:
  web:
    secrets: [database_url, auth_secret, mail_secret]
  mail:
    secrets: [database_url, auth_secret, mail_secret]
  accounts:
    secrets: [database_url, auth_secret, mail_secret]
secrets:
  database_url:
    file: ./secrets/database-url
  auth_secret:
    file: ./secrets/auth-secret
  mail_secret:
    file: ./secrets/mail-secret
```

Set `DATABASE_URL_FILE=/run/secrets/database_url`, `BETTER_AUTH_SECRET_FILE=/run/secrets/auth_secret`, and `PR0_MAIL_SECRET_FILE=/run/secrets/mail_secret` in `.env`. Mount SMTP and database password files similarly on the services that consume them. Restrict local file access, exclude the secret directory from Git, and preserve secrets in your protected backup process. No secret uses a `NEXT_PUBLIC_` or desktop build variable.

## Ingress, cookies, and bounded work

Account writes require the exact canonical `Origin`; the app also rejects cross-site authenticated reads. Email-link navigation may originate from another site. Only signup, sign-in, resend, verification, and sign-out are enabled under `/api/auth`; unused Better Auth routes cannot bypass the application guards. Library access validates verified email and persisted browser provenance on every request, renews the database session to 30 days from that use, and propagates the renewed HttpOnly/SameSite=Lax cookie. HTTPS origins use Secure cookies. There is no cookie cache, bearer plugin, or renderer-visible session token.

Next.js does not expose the socket peer in its Route Handler Request. Consequently the default is one conservative shared IP bucket. For per-client admission, set a high-entropy `PR0_INGRESS_SECRET` and place the web service behind ingress that strips incoming `X-Pr0-Ingress-Secret` and `X-Pr0-Client-IP`, then writes its own secret and observed client IP. For multiple proxy hops, resolve only an explicitly trusted chain at ingress. Never forward arbitrary client-supplied versions of these headers. Restrict direct backend reachability. Ordinary `X-Forwarded-For`, `X-Real-IP`, and Host headers never establish identity; an absent/incorrect ingress secret stays in the shared bucket. IPv6 clients share /64 buckets; IPv4 uses /32.

PostgreSQL atomically shares admission across processes: five signup attempts/hour/IP; three verification emails/hour/destination and twenty/hour/IP; ten failed sign-ins/15 minutes/account+IP and fifty/15 minutes/IP; sixty anonymous auth requests/minute/IP with ten-request bursts per ten seconds; 120 library requests/minute/account. Successful sign-ins refund their failed-login reservations. Email admission applies equally to unknown and known addresses. Throttling returns a stable code and `Retry-After` seconds.

Auth JSON is limited to 4096 decoded bytes, has a five-second body deadline, and rejects content encoding. Work admission permits sixteen active requests, four active library reads/account, and sixty-four queued requests with a five-second deadline. The full authentication/read lifecycle occupies a global work slot. A separate bounded control connection pool renews active leases every five seconds; leases recover slots after process death. Database statements and locks have bounded timeouts so stalled queries cannot hold ordinary work indefinitely. Email admission reserves capacity before looking up any account, so a full queue or invalid encryption/SMTP configuration produces the same public failure for existing and unknown addresses. At most 1000 pending jobs plus reservations are admitted; abandoned reservations expire after five minutes. Each worker iteration claims at most one job. Run one mail worker initially. All limits preserve refusal rather than silently dropping accepted account work.

Mail payloads are encrypted with AES-256-GCM. A worker claims jobs durably, attempts delivery at most five times with bounded exponential backoff, and never extends the original one-hour token expiry. It refuses delivery within thirty seconds of expiry, removes token payloads on success/terminal failure/expiry, and removes completed diagnostic rows after seven days. A crash after SMTP acceptance may cause duplicate delivery of the same link, never automatic verification. The original email verification token is the authority, not delivery status.

## Health and diagnosis

`/api/v1/health` is process liveness. `/api/v1/ready` additionally checks canonical configuration, PostgreSQL schema version, and a recent mail-worker heartbeat. The worker validates encryption configuration and checks the SMTP transport; a stale worker or sustained SMTP outage makes readiness unavailable. This is readiness for the account slice, not evidence of future search, deletion-ledger, or disaster-restore readiness.

```sh
docker compose ps
docker compose logs --tail=50 mail
docker compose run --rm accounts mail-status
docker compose run --rm accounts migrate
```

Logs contain event names, random job identifiers, and attempt counts, never account addresses, passwords, verification URLs, or encrypted payloads. Built-in auth logs and Next.js incoming-request logs are disabled. Configure your proxy to omit/redact verification query strings too. The UI gives non-enumerating signup/resend guidance, explicit retry delays, and an invalid/expired verification-link recovery path. After correcting SMTP, pending jobs retry within their original expiry; users can request a replacement through the shared email controls.

## Development and repeatable validation

For a source-run server, put the same settings in `apps/web/.env.local`, pointing `DATABASE_URL` to a local test PostgreSQL instance. Run `bun run --cwd apps/web accounts migrate`, `bun run --cwd apps/web mail:worker`, and `bun run dev:web` in separate terminals. Operational commands accept Bun's normal environment-file arguments when needed.

The deployment suite uses only generated disposable accounts and an isolated Mailpit SMTP sink. It reserves localhost ports 31424 and 18425, creates a randomly named Compose project, runs the actual production Next.js/Bun image, and removes only that project's own volumes afterward. Existing database services are untouched. Build the test image first:

```sh
docker build -t pr0-accounts-24 .
bun run --cwd apps/web test:accounts
```

Public HTTP assertions cover closed/open/allowlist admission, verification gating including direct requests, duplicate signup response equivalence, cross-account denial, forged origins/provenance/forwarding, bounded bodies and email admission, expiry/renewal, signed-out sessions, and disabled direct auth routes. Controlled clock/provenance fixture changes support negative server checks; outcomes are asserted through HTTP. Compose transitions verify durable outbox recovery, SMTP failure/retry, account/session/identity preservation across container recreation, Secure cookie configuration, idempotent migrations, and non-root Bun execution. Browser acceptance and actual results are recorded separately in the [issue #24 validation report](accounts-validation.md).

This slice does not certify the full MVP's backup/restore, signed Windows distribution, OAuth/recovery, prompt synchronization, capacity, or multi-browser accessibility release gates.
