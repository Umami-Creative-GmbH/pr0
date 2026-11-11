-- Account deletion is a hard delete in this database (ADR-0005). Only an
-- opaque tombstone remains: account ID, deletion handle and time. No email,
-- profile or prompt text is kept.
CREATE TABLE deleted_accounts (
  account_id text PRIMARY KEY,
  handle text UNIQUE,
  deleted_at timestamptz(3) NOT NULL
);
-- Deletions still pending under the former ledger design become tombstones.
-- Their accounts stay blocked by deletion_pending, and the server purges the
-- remaining live data before it admits account work.
INSERT INTO deleted_accounts(account_id, handle, deleted_at)
  SELECT account_id, handle, deleted_at FROM account_deletion_pending;
DROP TABLE account_deletion_pending;
ALTER TABLE instance DROP COLUMN deletion_anchor;
-- Contract step: a migration-20 server still expects the dropped objects.
UPDATE instance SET minimum_server_migration = 21;
-- Ledger hosts are gone; their storage samples would fail the metrics contract.
DELETE FROM storage_observation WHERE name IN ('ledger-a', 'ledger-b');
