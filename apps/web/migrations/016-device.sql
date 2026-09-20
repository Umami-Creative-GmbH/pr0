CREATE TABLE device_code (
  id text PRIMARY KEY,
  device_code text NOT NULL UNIQUE,
  user_code text NOT NULL UNIQUE,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at timestamp NOT NULL,
  status text NOT NULL,
  last_polled_at timestamp,
  polling_interval integer,
  client_id text,
  scope text,
  authentication_version integer
);
CREATE INDEX device_code_expiry ON device_code(expires_at);
