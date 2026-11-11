# Account deletion

Account deletion is a hard delete in the application database, plus a tombstone ([ADR-0005](../adr/0005-account-deletion-is-a-hard-delete-in-the-application-database.md)). There is no separate deletion store to provision.

## The journey

`POST /api/v1/account/deletion` requires a verified browser session, a matching account and email version, authentication completed within ten minutes and `confirmation: "delete-account"`. Better Auth's direct deletion route stays disabled. Before confirmation, `GET` on the same route returns the account's immutable identities and its random 256-bit deletion handle.

One transaction then removes the account and all of its live data: the account, sessions, tokens, devices and device codes, the library, prompts and history, pending mail, verification and admission state. In the same transaction the server removes the account's search index files, holding the lock the search workers take before they open those files. Only a row in `deleted_accounts` remains: the opaque account ID, the deletion handle and the deletion time. It has no email, profile or prompt text. If anything fails, the transaction rolls back and nothing is deleted; the request returns an error and can be retried.

A successful response is `{"status":"deleted","accountId":"…","deletedAt":"…"}`. Signing in, syncing, and every session and token of the account fail afterwards. Signing up again with the same email creates a new account with a new ID and an empty library.

Before submitting, the browser keeps the identities and the handle in origin-local storage, separately from the session. If the response is lost, a reload offers a status check that needs no session. Browser cleanup uses the kept identity, so a late response can't clear another account's cache or unsaved draft.

## Deletion status

`GET /api/v1/account-deletions/{handle}` needs no session. It answers `{"status":"deleted","accountId":"…","deletedAt":"…"}` from the tombstone, or `{"status":"absent"}`, with `Cache-Control: no-store`. A storage error is an error, never absence. The handle grants no library access. Avoid recording handles in ingress access logs.

A returning desktop looks up its retained handle on the instance it is signed in to. It clears that account's local library, pending work and credential only when the answer is `deleted` for exactly its retained account. `absent`, an error or another account ID never authorizes cleanup: after a restore, a deletion is absent until the operator re-applies it.

## The deletion log

For each deletion the web service writes one line to standard output:

```json
{
  "event": "account_deleted",
  "accountId": "6f0c…",
  "deletedAt": "2026-11-11T10:00:00.000Z"
}
```

It contains the opaque account ID and the time only, never the email. It is the only record of a deletion once an older backup has been restored, so keep it:

- for longer than the oldest backup you could restore (backups expire within 30 days), and
- somewhere that survives the loss of the application host and the removal of the web container. Docker's own container log is rotated and deleted with the container, so ship the web service's log to a log store, or copy the `account_deleted` lines out regularly.

Re-deletions write `account_redeleted` lines in the same format.

## Re-applying deletions after a restore

Restoring a backup brings back every account deleted after that backup was taken. Before reopening, re-apply the deletion log:

```sh
docker compose run --rm -T deletions reapply < deletion.log
```

The command reads the log on standard input, ignores every line that is not an `account_deleted` or `account_redeleted` event (including log-collector prefixes before the JSON), and deletes each listed account again in its own transaction with its original deletion time. It is idempotent: an account that is already gone keeps (or gets) its tombstone and nothing else. It prints `{"event":"deletions_reapplied","read":…,"purged":…}` and exits nonzero on any failure, after which you fix the cause and run it again. The [restore sequence](backup-restore.md#restore-sequence) says where this step belongs.

If the database you are replacing is still readable, its tombstones are a second source. Export them as log lines and append them to the input:

```sh
psql "$OLD_DATABASE_URL" -tAc "SELECT json_build_object('event','account_deleted','accountId',account_id,'deletedAt',to_char(deleted_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')) FROM deleted_accounts"
```

All web replicas must use the **same search volume**, because a deletion removes the account's index files from it. The supplied Compose files have one web service and one persistent search volume.

## Upgrading from the ledger design

Migration 21 creates `deleted_accounts`, turns every deletion still pending under the former ledger design into a tombstone, and drops the former local work table and pinned anchor. The server purges those accounts' remaining data before it admits account work again. The ledger databases are no longer read; keep or remove them under your own retention policy. Remove `PR0_LEDGER_A_URL`, `PR0_LEDGER_B_URL` and their `_FILE` variants from your configuration.

## Validation

Run `bun run --cwd apps/web test:account-deletion` for the real-PostgreSQL and served-browser checks. The suite uses ports 30456, 55456, 11456 and 18456 and owns only the `pr0-deletion-56` Compose project. It checks confirmation, freshness, provenance and identity, concurrent mutations, same-email recreation, a rolled-back deletion, the tombstone and status lookup, a tombstone carried over by migration 21, and restoring an older database copy followed by `deletions reapply`. The [backup and restore rehearsal](backup-restore.md#pre-release-and-quarterly-rehearsal) exercises the re-delete step from the served app's real log.

Earlier evidence for the ledger design is in [issue 56 validation evidence](../evidence/issue-56-account-deletion.md); it is historical.
