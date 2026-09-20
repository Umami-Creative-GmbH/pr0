CREATE TABLE library_snapshot (
  instance_id uuid NOT NULL, account_id text NOT NULL, id uuid NOT NULL,
  expires_at timestamptz NOT NULL, manifest text NOT NULL,
  PRIMARY KEY(instance_id, account_id),
  UNIQUE(instance_id, account_id, id),
  FOREIGN KEY(instance_id, account_id) REFERENCES library(instance_id, account_id) ON DELETE CASCADE
);
CREATE TABLE library_snapshot_page (
  instance_id uuid NOT NULL, account_id text NOT NULL, snapshot_id uuid NOT NULL,
  page integer NOT NULL CHECK(page BETWEEN 0 AND 1023),
  payload text NOT NULL CHECK(octet_length(payload) <= 4194304),
  PRIMARY KEY(instance_id, account_id, snapshot_id, page),
  FOREIGN KEY(instance_id, account_id, snapshot_id) REFERENCES library_snapshot(instance_id, account_id, id) ON DELETE CASCADE
);
