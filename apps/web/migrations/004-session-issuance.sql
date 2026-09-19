ALTER TABLE "user" ADD COLUMN authentication_version integer NOT NULL DEFAULT 0;
ALTER TABLE session ADD COLUMN authentication_version integer NOT NULL DEFAULT 0;

-- A login captures this version before checking the password. Serialize issuance
-- with password reset and reject a result authenticated against older credentials.
CREATE FUNCTION validate_session_issuance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_version integer;
BEGIN
  SELECT authentication_version INTO current_version FROM "user"
    WHERE id = NEW.user_id FOR SHARE;
  IF current_version IS NULL OR NEW.authentication_version <> current_version THEN
    RAISE EXCEPTION 'Authentication changed; sign in again';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_session_issuance BEFORE INSERT ON session
FOR EACH ROW EXECUTE FUNCTION validate_session_issuance();
UPDATE instance SET schema_version = 4;
