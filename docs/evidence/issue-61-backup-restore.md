# Issue #61 backup and restore evidence

The repeatable rehearsal uses the production Next.js build, Bun 1.4.2, PostgreSQL 17, two separate ledger databases, Mailpit, encrypted archives and actual `pg_restore` verification. The optional native journey drives the Rust command boundary over HTTPS through Edge and Windows Credential Manager. Recorded timestamps and measurements are in the adjacent JSON files; they contain no credentials or account identifiers.

- [Server recovery](issue-61-rehearsal.json): an ordinary checkpoint predates an acknowledged deletion and signing-key rotation. Unavailable and two-behind ledgers refuse preparation; one current ledger repairs the other. A failed search-file purge and process restart leave admission closed. Recovery removes the deleted account, retains the surviving prompt, changes epoch and rejects restored sessions and password-reset tokens. The measured loss interval and total recovery time are checked against one hour and 24 hours.
- [Storage failures](issue-61-storage-rehearsal.json): a stale checkpoint and failed retention cleanup expose `backup_unavailable`; expired ordinary data is removed. A wrong encryption key and modified authentication tag both refuse verification. A new verified archive restores healthy monitoring.
- [Pending deletion retry](issue-61-pending-rehearsal.json): a backup contains a pending deletion whose intent was not yet in the independent ledger. Recovery is interrupted after appending that intent and retries to signed completion without replacing the original sealed history.
- [Native recovery](issue-61-native-rehearsal.json): the expired server credential is revoked locally; same-account reauthentication precedes the new-epoch snapshot. Exact pending work and a previously acknowledged row newer than the backup remain available for recovery. No automatic wholesale upload occurs, including after an explicit upload command.

Run from the repository root:

```powershell
docker build --target migration-runtime -t pr0-migration-test-58 .
$env:PR0_RESTORE_NATIVE = '1'
$env:PR0_TEST_BROWSER = 'msedge'
$env:PR0_TEST_NATIVE_ORIGIN = 'https://localhost:30462'
bun --env-file=apps/web/tests/backup-restore.env apps/web/tests/backup-restore-runner.ts
```

The native journey requires the documented desktop Rust/MSVC tooling and Credential Manager. The runner uses a dedicated Compose project and fixture ports; it destroys only its disposable databases and archives. Rehearsal search/recovery files stay in an ignored, uniquely named `apps/web/.data/rehearsal-61-*` directory for inspection.

This small local dataset demonstrates recovery behavior. It does not demonstrate production storage independence, vault recovery after host loss, capacity, hidden provider-version expiry or external alert delivery. Before release and quarterly, follow the [operator rehearsal](../operations/backup-restore.md#pre-release-and-quarterly-rehearsal) against the installation's actual storage, credentials and representative dataset, retaining external measurements.

## Validation

On 2026-09-21, the combined server/storage/pending/native rehearsal passed. The ordinary checkpoint loss window was 1.180 seconds and measured server recovery took 6.764 seconds, with zero acknowledged deletions lost. Native recovery preserved pending work and emitted zero upload operations. Full workspace `bun run test`, `bun run typecheck` and `bun x --bun ultracite check` passed. Production Compose configuration and both `migration-runtime` and `runtime` Docker builds passed. Next.js reports the existing dynamic filesystem tracing warning in `search-location.ts`.

## Standards

The independent standards review reported no documented-standard violations. Its final follow-up noted optional duplication in three disposable-database resets; those identical commands were consolidated into `resetRehearsalDatabase()`.

## Spec

The independent specification review identified a pending-deletion retry failure. The new regression reproduced it before correction; the corrected coordinator and combined rehearsal passed, and the follow-up review reported no remaining confirmed specification findings.

Final review: Standards 0 remaining findings (one optional smell addressed); Spec 0 remaining findings (one P1 corrected and verified).
