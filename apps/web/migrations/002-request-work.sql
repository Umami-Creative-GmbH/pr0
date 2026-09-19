CREATE TABLE request_work (
  id uuid PRIMARY KEY, owner text,
  active boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL
);
CREATE INDEX request_work_expiry_idx ON request_work(expires_at);
UPDATE instance SET schema_version = 2;
