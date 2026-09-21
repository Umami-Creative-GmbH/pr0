CREATE TABLE waiting_poll (
  id uuid PRIMARY KEY,
  owner text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX waiting_poll_expiry ON waiting_poll(expires_at);
ALTER TABLE request_work ADD COLUMN queued_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE "user" ADD COLUMN suspended boolean NOT NULL DEFAULT false;
ALTER TABLE instance ADD COLUMN registration_paused boolean NOT NULL DEFAULT false;
CREATE TABLE search_work (
  id uuid PRIMARY KEY, owner text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT false,
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE search_projection_health (
  account_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  epoch uuid NOT NULL, revision bigint NOT NULL, prepared_at timestamptz NOT NULL,
  file_signature text
);
CREATE TABLE operational_counter (
  day date NOT NULL DEFAULT CURRENT_DATE, boundary text NOT NULL, code text NOT NULL,
  count bigint NOT NULL DEFAULT 1, PRIMARY KEY(day,boundary,code)
);
CREATE TABLE storage_observation (
  name text PRIMARY KEY, total_bytes bigint NOT NULL CHECK(total_bytes>0),
  used_bytes bigint NOT NULL CHECK(used_bytes>=0 AND used_bytes<=total_bytes), sampled_at timestamptz NOT NULL
);
CREATE TABLE backup_observation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  checkpoint timestamptz NOT NULL, retention_ok boolean NOT NULL, verified_at timestamptz NOT NULL
);
