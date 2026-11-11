# Account deletion is a hard delete in the application database

Status: accepted 2026-11-11 (release operator decision, #139). Supersedes the deletion-evidence design of #56, #57 and #61: two independent deletion ledgers, signed Ed25519 receipts, the signing anchor, `restore seal` and deletion replay. Amends [ADR-0004](0004-coolify-runs-the-hosted-stack-with-phase-as-config-source.md), whose hosted deploy ran a `replay-deletions` job.

Account deletion used to write an intent and a signed completion to two PostgreSQL ledgers on independent hosts, outside the application database and its backups. After a restore, the restore coordinator sealed both ledgers' history and replayed every deletion, so no acknowledged deletion could come back. Desktops cleaned up only after they verified a signed receipt from a pinned key. This gave a deletion zero permitted loss, but it needed two more durable database hosts, their credentials, capacity monitoring and alerts, a key rotation procedure, and a restore procedure with failure modes of its own. For a small app with one operator that was too much to run.

## Decision

- **Hard delete plus tombstone in the single application PostgreSQL.** One transaction removes the account and all of its live data: the account, sessions, tokens, devices, library, prompts, history, pending mail and admission state. The same transaction removes its search index files, under the lock the search workers use. Only a `deleted_accounts` row remains: the opaque account ID, the opaque deletion handle and the deletion time. It holds no email, profile or prompt text.
- **The deletion log.** For each deletion the server writes one structured line, `{"event":"account_deleted","accountId":"…","deletedAt":"…"}`, without the email. With `PR0_DELETION_LOG_DIRECTORY` set (required on the hosted service, optional for self-hosters) it appends the line to a monthly file `deletions-YYYY-MM.jsonl` in a directory on off-server storage, beside and never inside the backup directory, and flushes it **inside the deletion's transaction, before commit**. A failed append rolls the deletion back with a retryable error, so no deletion commits unrecorded. The line also goes to standard output. `backup create` and `backup retention` remove a month's file 31 days after the month ends.
- **Restore is a documented manual step.** After restoring a backup, and before reopening, the operator re-applies every deletion from the deletion log: `deletions reapply` reads the log directory or files (or standard input) and deletes each listed account again, idempotently and with its original time. There is no automatic cross-store replay. See the [backup and restore runbook](../operations/backup-restore.md#restore-sequence).
- **Unsigned deletion status.** `GET /api/v1/account-deletions/{handle}` answers `deleted` (with the account ID and time) from the tombstone, or `absent`. A desktop cleans up only when the instance it is signed in to, over its verified HTTPS origin, answers `deleted` for exactly its retained account. Absence never authorizes cleanup.
- **Removed:** both ledger stores and their configuration (`PR0_LEDGER_A_URL`, `PR0_LEDGER_B_URL`), the signed receipts and the signing anchor (`deletionKey` in the capabilities), the key rotation statements and the verification endpoint, `deletions initialize`, `rotate` and `replay`, `restore seal` and its ledger checkpoint, the readiness check `deletionReplay`, the ledger metrics and alerts (`ledger_unavailable`, `deletion_pending`, the `ledger-a` and `ledger-b` storage volumes), and the hosted `replay-deletions` deploy job. This also supersedes the ledger parts of #123.
- Migration 21 creates the tombstone table and drops the former local deletion work table (`account_deletion_pending`) and the pinned anchor. A deletion that was still pending under the old design becomes a tombstone, and the server purges that account's remaining data before it admits account work again.

## Accepted risk

**A deletion made after a backup comes back if that backup is restored and the operator does not re-apply it.** The tombstone lives in the same database as the data, so restoring an older copy restores the deleted account, its library and its sessions as they were, and removes the tombstone. Until the operator runs the re-delete step, a restored instance would let that person sign in again. The restore runbook therefore keeps ingress and the restore barrier closed until the re-delete step is done, and the re-delete step depends on the deletion log covering at least the time since the restored backup was taken.

The deletion log is the only record of those deletions once the database is restored, so its retention matters: it must reach back further than the oldest backup that could be restored (30 days), and it must not live only on the host whose loss the restore recovers from. The log file directory on the off-server storage meets both (31 days past each month's end). A self-hoster who leaves `PR0_DELETION_LOG_DIRECTORY` unset has only standard output, which container logging rotates and removes with the container; the self-hosting documentation warns about this.

A commit that fails after its line was flushed leaves a line for a deletion that did not happen. Re-applying it after a restore deletes an account whose owner had confirmed the deletion; we accept that rather than risk an unrecorded deletion.

A desktop now trusts its instance's unsigned answer. A compromised or misconfigured instance could tell a desktop that its account was deleted and make it remove its local library. The instance already controls the account and its canonical data, so this adds no new authority; the desktop still requires its verified HTTPS origin and an exact account match.

## Consequences

- One PostgreSQL, one backup, one restore procedure. The hosted service needs no ledger hosts, and a deploy runs only `backup-before` and `migrate`.
- A deletion either completes or changes nothing. There is no `pending` state, no background completion and no status check against a second store.
- The deletion API, the shared contract, the OpenAPI document, the api-client and the desktop change together. Desktops built before this decision require `deletionKey` in the capabilities and stop working against this server. No desktop version has been released yet (the live manifest names none), so no supported predecessor is affected. This desktop still accepts and ignores `deletionKey` from an older server and a retained receipt from an older build, which marks a cleanup that must finish.
- Same-email signup after deletion is a new account with a new ID, as before. Re-applying a deletion never touches it, because the deletion log names account IDs, not emails.

## Considered options

- **Keep the ledgers** and operate them: rejected as too complex to run for this app.
- **One ledger instead of two:** it keeps most of the operational cost (another durable host, credentials, key management, sealing) and loses the independence the design relied on.
- **Automatic re-delete from tombstones exported into each backup's successor:** rejected for now. It needs a durable store outside the restored database, which is the ledger problem again. The structured log plus a manual step is the simplest thing that works, and its risk is written down here.

## Amendment 2026-11-11: the deletion log is a file on the Storage Box

Decided by the release operator on #139/#140. The hosted service sets `PR0_DELETION_LOG_MOUNT` (Phase, `config`, required) to the Storage Box's `deletion-log` directory, mounted at `/var/lib/pr0-deletion-log` into web, restore, backup and (read-only) deletions. This replaces "ship standard output to a log store" as the way the log survives the server. The hosted launch gate item "deletion log shipped and kept off the server, re-delete step rehearsed" ([ADR-0002](0002-mvp-release-requires-verified-candidate-and-hosted-launch.md)) is met by that directory and the restore rehearsal's re-delete from it.
