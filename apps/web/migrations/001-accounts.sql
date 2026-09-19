CREATE TABLE instance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  id uuid NOT NULL UNIQUE,
  schema_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION preserve_instance_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Instance identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_instance BEFORE UPDATE OR DELETE ON instance
FOR EACH ROW EXECUTE FUNCTION preserve_instance_identity();
CREATE TABLE "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false, image text,
  created_at timestamp NOT NULL, updated_at timestamp NOT NULL
);
CREATE TABLE session (
  id text PRIMARY KEY, expires_at timestamp NOT NULL, token text NOT NULL UNIQUE,
  created_at timestamp NOT NULL, updated_at timestamp NOT NULL,
  ip_address text, user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provenance text NOT NULL DEFAULT 'browser' CHECK (provenance IN ('browser', 'device'))
);
CREATE INDEX session_user_idx ON session(user_id);
CREATE TABLE account (
  id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text, refresh_token text, id_token text,
  access_token_expires_at timestamp, refresh_token_expires_at timestamp,
  scope text, password text, created_at timestamp NOT NULL, updated_at timestamp NOT NULL,
  UNIQUE(provider_id, account_id)
);
CREATE INDEX account_user_idx ON account(user_id);
CREATE TABLE verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
  expires_at timestamp NOT NULL, created_at timestamp NOT NULL, updated_at timestamp NOT NULL
);
CREATE INDEX verification_identifier_idx ON verification(identifier);
CREATE TABLE library (
  instance_id uuid NOT NULL REFERENCES instance(id),
  account_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  UNIQUE(instance_id, account_id)
);
CREATE FUNCTION create_account_library() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO library(instance_id, account_id) SELECT id, NEW.id FROM instance;
  IF NOT FOUND THEN RAISE EXCEPTION 'Instance is not initialized'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_library AFTER INSERT ON "user"
FOR EACH ROW EXECUTE FUNCTION create_account_library();
CREATE TABLE registration_admission (email text PRIMARY KEY);
CREATE TABLE admission_bucket (
  key text PRIMARY KEY, started_at timestamptz NOT NULL, count integer NOT NULL
);
CREATE TABLE mail_job (
  id uuid PRIMARY KEY, payload text, expires_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','failed','expired')),
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX mail_due_idx ON mail_job(next_attempt_at) WHERE state = 'pending';
CREATE TABLE worker_health (name text PRIMARY KEY, heartbeat_at timestamptz NOT NULL);
