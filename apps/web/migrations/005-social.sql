CREATE TABLE social_attempt (
  state_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE TABLE social_pending (
  id_hash text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('google', 'github')),
  subject text NOT NULL,
  email text,
  token_hash text,
  expires_at timestamptz NOT NULL
);
UPDATE instance SET schema_version = 5;
