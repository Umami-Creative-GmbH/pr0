# External probe host and alerting

The hosted launch gate (ADR-0002, spec #120) requires availability to be measured and alerted on from a host **outside the deployment**. The probe host is a small Linux VPS from a different provider than the app host. Every UTC minute it:

1. runs the [availability probe](service-health.md#external-availability-probe) with the canary account and appends the sample to that month's evidence file;
2. polls the private metrics route with the bearer secret;
3. sends ntfy push and email alerts;
4. sends a heartbeat to an EU-hosted dead-man's switch.

The repository contents are in `infrastructure/probe-host/`:

| File | Purpose |
| --- | --- |
| `minute.ts` | One probe minute: probe, metrics poll, alert rules, delivery, heartbeat |
| `alert-rules.ts` | The alert rules (tested in `alert-rules.test.ts`) |
| `systemd/pr0-probe.service`, `systemd/pr0-probe.timer` | Oneshot unit and the every-UTC-minute timer |
| `systemd/probe.env.example` | Non-secret settings |
| `heartbeat.sh` | Sends an exit code to the dead-man's switch. The app host's scheduled backup uses the same protocol through `infrastructure/hosted/heartbeat.ts` |

## Alert rules

| Condition | Sent by | When |
| --- | --- | --- |
| Probe unavailable | probe host (ntfy + email, urgent) | after **3 consecutive failed UTC minutes**. Minutes with no sample count as failed, and a failed duplicate sample makes its minute failed. One alert per outage, and a recovery notice when a probe succeeds again |
| Any metrics alert | probe host (ntfy + email, urgent) | **immediately**, as soon as `/api/v1/operations/metrics` reports an alert name that wasn't active before. A notice is sent when all alerts clear |
| Metrics route unreadable | probe host (ntfy + email, urgent) | after 3 consecutive failed polls (unreachable, 404/unauthorized, timeout or a response that doesn't match the contract) |
| Probe gap | probe host (ntfy + email) | when the probe resumes after 3 or more minutes without samples |
| Probe loop silent or failing | dead-man's switch (its own ntfy + email integrations) | the `pr0-probe` check misses its 1-minute heartbeat beyond the grace time, or receives a nonzero exit code because an alert couldn't be delivered |
| Backup silent or failing | dead-man's switch | the `pr0-backup` check misses its 30-minute heartbeat beyond the grace time, or receives a nonzero `backup create` exit code |

Expired credentials, search preparation (`search_preparing`), maintenance, redirects and timeouts all count as unavailable. The probe never discards a failed sample. If the probe process can't report one, `minute.ts` appends a failed sample itself. A run that overruns the minute is stopped by systemd, so that minute has no sample and counts as unavailable.

Delivery is per channel. A channel that fails (for example, ntfy is down) stays in an outbox in the state file and is retried every minute without repeating channels that already succeeded. While anything is undelivered, the run exits 1 and the heartbeat reports `1`, so the dead-man's switch raises the alarm through its own channels.

## Secrets

Secrets are files, never command-line arguments, environment values or log lines. Store them root-owned with mode `0600` in `/etc/pr0-probe/credentials/`. systemd's `LoadCredential=` exposes them to a single run only. Each file holds one value:

| File | Content |
| --- | --- |
| `canary-cookie` | The canary browser session's `Cookie` header value (see below) |
| `metrics-secret` | The `PR0_METRICS_SECRET` of the hosted service |
| `ntfy-url` | The full ntfy topic URL (the topic name is a secret on public ntfy servers) |
| `ntfy-token` | An ntfy access token. If the topic needs no token, delete this line and its `Environment=` line from the unit |
| `smtp-url` | `smtps://user:password@smtp-relay.example:465` for alert email. Use a sender other than the application's own mail relay, so that an application email outage can't hide alerts |
| `heartbeat-url` | The dead-man's switch ping URL for the `pr0-probe` check |

The probe output and the run summary contain only the time, duration, availability, metric alert count and delivery counts.

## Installing the probe host

```sh
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin pr0-probe
sudo git clone https://github.com/Umami-Creative-GmbH/pr0.git /opt/pr0
cd /opt/pr0 && sudo git checkout <server-commit> && sudo bun install --frozen-lockfile
sudo install -d -m 0700 /etc/pr0-probe/credentials
sudo install -m 0644 infrastructure/probe-host/systemd/probe.env.example /etc/pr0-probe/probe.env   # then edit
# write each secret file listed above with mode 0600
sudo install -m 0644 infrastructure/probe-host/systemd/pr0-probe.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now pr0-probe.timer
journalctl -u pr0-probe.service -n 5
```

Bun must be at `/usr/local/bin/bun` (the version in the root `package.json`). Evidence is kept in `/var/lib/pr0-probe/evidence/<YYYY-MM>.jsonl` and the alert state in `/var/lib/pr0-probe/alert-state.json`. After each candidate redeploy, update the checkout to the deployed server commit, because the metrics response is validated against that commit's contract.

The ingress allows the metrics route only from the probe host's address (#126). Record that address when provisioning the VPS.

## Dead-man's switch

Use an EU-hosted, Healthchecks-compatible service: one that accepts `POST <ping-url>/<exit-code>`, such as Healthchecks.io (EU-hosted) or a self-hosted Healthchecks instance. Include it in the processor agreements. Create two checks and connect both to the same ntfy topic and email recipients:

| Check | Period | Grace | Pinged by |
| --- | --- | --- | --- |
| `pr0-probe` | 1 minute | 3 minutes | `minute.ts`, every run: `0` when every alert was delivered, otherwise `1` |
| `pr0-backup` | 30 minutes | 15 minutes | the hosted application's Coolify scheduled backup task ([hosted](hosted.md#scheduled-backup)), with `backup create`'s exit code |

A nonzero exit code marks the check down immediately. A missing ping marks it down after the grace time.

## Canary account and prompt

1. Add a dedicated address (for example `canary+pr0@umami-creative.app`) to the registration allowlist, sign up on the hosted origin and verify the email. Don't use it for anything else and don't share prompts with it.
2. In that account, create exactly one prompt titled `pr0-availability-canary` and copy its UUID into `PR0_PROBE_PROMPT_ID`.
3. In a private browser window, sign in as the canary and copy the session cookie as a `Cookie` header value: `__Secure-better-auth.session_token=<value>` on HTTPS. Write it to `/etc/pr0-probe/credentials/canary-cookie` (mode `0600`) and close the window **without signing out**.
4. Wait for the next minute and check `journalctl -u pr0-probe.service` for `"available":true`.

## Session renewal

Sessions expire after 30 days without activity. The probe uses the session every minute, so it normally stays valid. Replace the cookie (step 3 above, then sign out any older canary sessions) when:

- the probe reports unavailable while the service is otherwise healthy (an expired or revoked session counts as unavailable and is **not** removed from the evidence);
- the probe host has been stopped for more than a few weeks;
- the canary's password or sessions are changed;
- every 90 days, together with secret rotation.

## Secret rotation

Every 90 days, and immediately if a probe-host secret might be exposed:

1. **Metrics secret:** generate a new value, deploy it as `PR0_METRICS_SECRET_FILE` on the app host, then write it to `metrics-secret`. Expect at most one or two unreadable polls, which is below the alert threshold.
2. **Canary cookie:** renew the session as described above.
3. **ntfy token or topic, SMTP credentials and heartbeat URL:** create the new value at the provider, write the file, wait for one minute with a delivered alert or heartbeat, then revoke the old value.

Changing a file needs no restart, because every run reads its credentials anew.

## Evidence rotation

Each sample is appended to the evidence file for the current UTC month, so a new file starts automatically on the 1st. After the first day of a month:

```sh
bun run --cwd apps/web availability report /var/lib/pr0-probe/evidence/2026-11.jsonl 2026-11
sha256sum /var/lib/pr0-probe/evidence/2026-11.jsonl
```

Copy the finished month's file, its report and its hash to the evidence archive (the hosted-launch tracking issue during burn-in, then the operations archive). Keep at least 13 months on the probe host. Never edit or filter an evidence file. The report command refuses files larger than 32 MiB.

## Burn-in report

The burn-in is 7 × 1440 consecutive UTC minutes at or above 99.5%, with missing samples counted as unavailable. Pass the first minute of the window and every monthly file it spans:

```sh
bun run --cwd apps/web availability burn-in 2026-11-27T09:00:00.000Z \
  /var/lib/pr0-probe/evidence/2026-11.jsonl /var/lib/pr0-probe/evidence/2026-12.jsonl
```

The output uses the monthly report's semantics: a minute is available only if it has at least one sample and every sample in it succeeded within 15 seconds, a sample belongs to the minute it started in, and the window end is exclusive. `complete` is false until all 10 080 minutes have elapsed; until then, the elapsed minutes (including the current partial one) are reported and `targetMet` stays false. The command exits 0 only when `targetMet` is true. The window must start on a whole minute, at or after the minute the full stack, backups and canary all ran on a `main` commit. It must end no more than 24 hours before the release act, and the final candidate's server must have run for at least its last 24 hours.

Record for the go/no-go record: the command, its JSON output, the evidence files' SHA-256 hashes and the deployment times of each candidate within the window.

## Deliberate-failure test

Run this before the burn-in starts, and again after changing alert channels. It proves end-to-end delivery for each rule:

1. **Probe alert:** on the probe host, move `canary-cookie` aside (the canary looks expired). After the third failed minute, confirm the urgent ntfy push and the email "pr0 unavailable". Restore the file and confirm "pr0 available again". These minutes stay in the evidence as unavailable, so run the test before the burn-in window.
2. **Metrics alert:** on the app host, record a stale backup observation with `bun run --cwd apps/web operations record-backup <a timestamp more than one hour ago> retention-ok`. Confirm that "pr0 metrics alert … backup_unavailable" arrives within one minute. Then run a verified backup and confirm the "cleared" notice.
3. **Undelivered alert:** temporarily write an invalid `ntfy-url` during step 1. Confirm that the email still arrives, the `pr0-probe` check turns down through the dead-man's switch's own channels, and the push arrives once the file is restored.
4. **Silent probe host:** `sudo systemctl stop pr0-probe.timer`. Confirm that the dead-man's switch alerts after the grace time, then restart the timer. These minutes are missing and count as unavailable.
5. **Silent or failing backup:** on the app host, ping the backup check with `pr0c exec backup bun /app/hosted/heartbeat.ts 1` (or disable the Coolify scheduled task for longer than the grace time). Confirm the alert, then let the next scheduled backup report `0`.

For each step, record the start time (UTC), the time each alert arrived on each channel (screenshots of the push and email with addresses redacted), the matching `journalctl -u pr0-probe.service` lines and the dead-man's switch event log. Keep redacted copies in `docs/evidence/` and link them from the hosted-launch tracking issue.

## Verification commands

```sh
bun test infrastructure/probe-host
bun test apps/web/scripts
bun run typecheck
```

The probe-host tests run `minute.ts` against local stand-ins for the service, ntfy, SMTP and the dead-man's switch. They aren't production evidence. The real evidence is the deliberate-failure record and the probe's own files.
