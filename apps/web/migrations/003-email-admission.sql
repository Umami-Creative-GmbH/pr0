ALTER TABLE registration_admission ADD COLUMN first_account boolean NOT NULL DEFAULT false;
CREATE TABLE mail_reservation (
  id uuid PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
UPDATE instance SET schema_version = 3;
