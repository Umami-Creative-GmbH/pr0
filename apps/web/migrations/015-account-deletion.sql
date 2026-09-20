CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE instance ADD COLUMN deletion_anchor text;
ALTER TABLE "user" ADD COLUMN deletion_pending boolean NOT NULL DEFAULT false;
ALTER TABLE library ADD COLUMN deletion_handle text NOT NULL DEFAULT translate(rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+/', '-_');
CREATE UNIQUE INDEX library_deletion_handle ON library(deletion_handle);
CREATE TABLE account_deletion_pending (
  account_id text PRIMARY KEY, instance_id uuid NOT NULL,
  handle text NOT NULL UNIQUE, deletion_id uuid NOT NULL UNIQUE,
  deleted_at timestamptz(3) NOT NULL
);
-- Deliberately not an FK: work survives removal of the account and sessions.
CREATE OR REPLACE FUNCTION validate_session_issuance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_version integer;
BEGIN
  SELECT authentication_version INTO current_version FROM "user"
    WHERE id = NEW.user_id AND NOT deletion_pending FOR SHARE;
  IF current_version IS NULL OR NEW.authentication_version <> current_version THEN
    RAISE EXCEPTION 'Authentication changed; sign in again';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION validate_session_renewal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM "user" WHERE id=NEW.user_id AND NOT deletion_pending FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account unavailable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_session_renewal BEFORE UPDATE ON session
FOR EACH ROW EXECUTE FUNCTION validate_session_renewal();
-- Signup mail is enqueued before Better Auth commits the new user. The owner is
-- checked at delivery and removed explicitly by account purge, not by an FK.
ALTER TABLE mail_job ADD COLUMN account_id text;
