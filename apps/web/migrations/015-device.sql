CREATE TABLE device_code (
  id text PRIMARY KEY,
  device_code text NOT NULL UNIQUE,
  user_code text NOT NULL UNIQUE,
  user_id text,
  expires_at timestamp NOT NULL,
  status text NOT NULL,
  last_polled_at timestamp,
  polling_interval integer,
  client_id text,
  scope text,
  authentication_version integer
);
CREATE INDEX device_code_expiry ON device_code(expires_at);
CREATE TABLE instance_deletion_key (
  instance_id uuid PRIMARY KEY REFERENCES instance(id),
  kid text NOT NULL UNIQUE,
  public_key text NOT NULL,
  private_key text NOT NULL
);
CREATE TABLE account_deletion_handle (
  account_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  handle text NOT NULL UNIQUE
);
