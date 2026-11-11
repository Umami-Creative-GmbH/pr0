# Self-hosting acceptance for issue #62

The deployment uses the root `compose.yaml`, its production Dockerfile targets and an operator-selected canonical origin. [The runbook](self-hosting.md) connects clean initialization, account admission, independent deletion storage, HTTPS/SMTP, desktop onboarding, maintenance, upgrade and disaster recovery. `compose.secrets.example.yaml` supplies the file-mount example; the acceptance fixture exercises mounted secrets on every consuming job.

## Reproduction and environment

The checkout starts at `5452d055ac7bcaed880eb3aad6e252ae1a67a9eb`, with the issue #62 deployment changes. Docker Desktop 4.98.0 (245422), Linux Engine 29.9.2 and Compose v5.6.1 run on Windows/AMD64. Host scripts use Bun 1.4.4; application/tool containers pin Bun 1.4.2. The application pins Next.js 16.3.5 and Better Auth 1.7.5. Native commands use the repository's Rust 1.94.0 toolchain, real Windows Credential Manager and clipboard, plus installed Edge for browser approval. Container PostgreSQL/tool versions and measured recovery times come from each successful run's JSON.

```sh
docker build --target runtime -t pr0-self-host-62 .
docker build --target migration-runtime -t pr0-self-host-tools-62 .
bun run --cwd apps/web test:self-hosting native --evidence=docs/evidence/issue-62-amd64.json
```

For ARM64, build both targets with `--platform linux/arm64`, then set `PR0_SELF_HOST_PLATFORM=linux/arm64`, `PR0_SELF_HOST_IMAGE=pr0-self-host-62-arm64` and `PR0_SELF_HOST_TOOLS_IMAGE=pr0-self-host-tools-62-arm64` for the same runner. Use `--evidence=docs/evidence/issue-62-arm64.json`. This forces the application, tooling, database and SMTP services to execute ARM64. Execution under Docker's emulation is not a native ARM hardware performance measurement. Image metadata or a completed cross-build alone does not pass acceptance.

The fixture creates two unique Compose projects, random loopback ports, independent databases, persistent volumes and generated secret files. It removes only its own disposable projects/volumes afterward. Its local SMTP service is a test dependency; the base production Compose intentionally leaves mail and ingress to operators. The PostgreSQL service has no host port and belongs only to the internal database network. There is one web replica, at most two in-process Bun search workers and a shared persistent derived-search volume.

## Recorded results

[AMD64 evidence](../evidence/issue-62-amd64.json) records a passing complete Compose/browser/native/upgrade/recovery journey on 2026-11-08, with PostgreSQL 17.10, pg_dump 17.11 (Debian 17.11-1.pgdg12+2) and Bun 1.4.2. The measured ordinary checkpoint gap was 2.515 seconds and recovery took 19.383 seconds. These are tiny fixture measurements, not production recovery or capacity estimates.

The tested AMD64 application image is `sha256:d7d832138c6a685c418352a4b4fcb705cf3d339617b608718e3d448ff64d01eb` (`pr0-self-host-62-final`); its matching tools image is `sha256:65b63101c5eabfc7c7ebc427905415757101b25cefe2525c557220f51a733e75` (`pr0-self-host-tools-62-final`). Select those tags with `PR0_SELF_HOST_IMAGE`/`PR0_SELF_HOST_TOOLS_IMAGE` to reproduce that record.

[ARM64 evidence](../evidence/issue-62-arm64.json) records the same complete Compose/browser/upgrade/recovery journey passing with every fixture service forced to `linux/arm64` under emulation. The application actually reported `aarch64`; Bun/PostgreSQL/tool versions matched the AMD64 run. The measured checkpoint gap was 8.08 seconds and recovery took 59.219 seconds. The application image is `sha256:936b2cd0b6eac137abbd2bb0fd8260d02c1f71f623cc0500c0ac370ce9568522`, and its tools image is `sha256:a3b0ae57e43013b7c3246e53be0995d077d09fae3c79fe983b7fe018ca15cca8`. This is functional ARM64 execution evidence, not a native-hardware capacity measurement.

Workspace typechecking, `bun run test` (Turbo cache used), and `bun run check` passed. Standards and Spec reviews against `5452d055` each reported zero actionable findings. Review used the staged diff before committing.

**The complete native journey passed after unlocking Windows.** It exercised HTTPS approval, Windows Credential Manager across native process restart, actual OS clipboard variable copy with the server stopped, offline edit/reconnect, same-email instance switching and the later recovery portion. The AMD64 success record marks `nativeHttpsOfflineReconnectAndSwitch: true`. Earlier attempts failed because Windows session 2 was locked: an isolated existing clipboard test also failed and `OpenClipboard` returned error 5 with `LogonUI` active. After the operator unlocked it, the isolated OS test and complete journey passed. No successful clipboard result was substituted with a mock; the test controller retries only a rejected OS write, never an acknowledged write/usage result.

The first supplementary Rust library run also exposed an expired test fixture. The shared protocol vector's example session expires on 2026-10-20, before this 2026-11-08 rehearsal. Its `windows_credential_survives_new_process` case correctly restored `authentication_required`, and other restore-based tests failed or waited indefinitely. The Rust test helper now creates a fresh 30-day fixture session; explicit expiry tests still replace that timestamp. The shared protocol vector and production authentication/storage code are unchanged. The interrupted first run's orphaned process was stopped before rerunning.

The final `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` run passed **168 tests, zero failures**, including credential process restart, concurrent restoration and the actual OS clipboard write. It completed in 38.84 seconds. Two existing unused test-helper warnings remain; they do not affect the result.

## Journey observed at public boundaries

| Boundary | Verification |
| --- | --- |
| Compose/operator CLI | Explicit migration, recovery initialization, first-account admission, mounted secret reads, database/search storage sampling, selected app/tool image tags and private database networking |
| Verified access | Closed signup refusal, admitted signup, unverified login refusal, SMTP verification link using the configured origin, verified sign-in |
| Served browser | Disabled social options absent; create/save literal template; search; actual clipboard copy of `Hello self-hoster, count +02.50`; saved placeholders remain unchanged |
| Ordinary lifecycle | Restart and `down`/`up` retain instance/account/session and exact prompt content; migrations can be reapplied |
| Version upgrade | Reconstruct schema 19 as a controlled storage fixture; deny migration backup preflight; observe closed public admission; run the production container coordinator to schema 20 and preserve the prompt and identities |
| Independent instances | Verify the same email on a second independent instance; different account/instance IDs, empty library, and refusal of the first instance's cookie |
| Native commands | Select HTTPS origins and approve matching browser codes; persist credentials across native process restart; copy variables with the server stopped; retain offline edit and reconnect; switch to the empty second instance and back |
| Backup/recovery | Encrypt and scratch-restore a backup; acknowledge a later deletion; read the deletion log from the web container; close; replace only the ordinary database; restore; see the deleted account back; `deletions reapply` from the log; reject pre-backup reopen; rotate auth secret; prepare/rebuild; verify backup and reopen |
| Post-restore REST | Old sessions fail, the survivor retains identity and template under a new epoch, the deleted login fails, and the deletion status lookup answers `deleted` for the re-deleted account |

Assertions use public REST/validated clients, served browser controls and typed native commands. Storage manipulation is confined to disposable setup for schema predecessor reconstruction and explicit ordinary-database loss. No assertion infers successful application behavior from a private database query. The suite polls process startup before checking intentionally closed admission and drives on-demand server search catch-up after native uploads. Readiness remains honest about stale projections.

## Limits of this evidence

This is a small functional rehearsal, not the 1,000-account/10-GiB capacity fixture or a minimum host requirement. It does not certify native ARM hardware, the performance budgets in #65, independently durable physical hosts, off-server mount/key retrieval, retention of hidden backup versions or actual operator alert delivery. Those must be rehearsed against the selected infrastructure before public use and quarterly.

The SMTP sink runs plaintext only with the loopback HTTP evaluation origin. During native HTTPS testing, the already-running evaluation mail worker continues serving that sink; the web container validates production TLS configuration, and no mail is sent in that stage. Native HTTPS trusts a dedicated ephemeral fixture root through the existing transport test boundary; this is not a Windows certificate-store installation test. Real trusted ingress, SMTP delivery and optional Google/GitHub consent/callbacks require operator integration. The email/password path itself uses no OAuth fixture or provider preload.

The native command executable is compiled from the real Rust service and uses real Windows credentials/clipboard. It is not a signed installed desktop release; installed lifecycle/update acceptance remains in #64/#112 and the release-candidate gate. Instance selection never configures executable-update trust. No account/library merging or update-channel redirection was introduced.

Runs emit redacted JSON evidence only after journey assertions complete, with architecture, exact runtime/tool versions and measured loss/recovery windows. The command's final exit also checks fixture cleanup. Ordinary backups and local fixture deletion volumes are deliberately destroyed only during fixture cleanup; the production runbook explicitly prohibits volume removal during maintenance or recovery.
