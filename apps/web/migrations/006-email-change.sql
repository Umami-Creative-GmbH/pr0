ALTER TABLE "user" ADD COLUMN email_version integer NOT NULL DEFAULT 0;
CREATE TABLE fresh_auth (
  session_id text PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES instance(id),
  account_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  email_version integer NOT NULL,
  expires_at timestamptz NOT NULL
);
UPDATE instance SET schema_version = 6;
CREATE TABLE account_challenge (
  id uuid PRIMARY KEY,
  session_id text NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES instance(id),
  account_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  email_version integer NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('reauth', 'email')),
  email text NOT NULL,
  digest text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  UNIQUE(session_id, purpose)
);
CREATE TABLE account_notice (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'failed'))
);
CREATE INDEX account_notice_owner ON account_notice(account_id, created_at DESC);

CREATE FUNCTION invalidate_email_authentication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email <> OLD.email THEN
    NEW.email_version := OLD.email_version + 1;
    DELETE FROM fresh_auth WHERE account_id = OLD.id;
    DELETE FROM account_challenge WHERE account_id = OLD.id;
    DELETE FROM verification WHERE value = OLD.id AND identifier LIKE 'reset-password:%';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invalidate_email_authentication BEFORE UPDATE OF email ON "user"
FOR EACH ROW EXECUTE FUNCTION invalidate_email_authentication();
