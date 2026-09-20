ALTER TABLE instance ADD COLUMN recovery_epoch uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE library ADD COLUMN prompt_count integer NOT NULL DEFAULT 0 CHECK (prompt_count BETWEEN 0 AND 10000);
ALTER TABLE library ADD COLUMN text_bytes bigint NOT NULL DEFAULT 0 CHECK (text_bytes BETWEEN 0 AND 104857600);
CREATE TABLE prompt (
  instance_id uuid NOT NULL, account_id text NOT NULL, id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text NOT NULL CHECK (char_length(description) <= 2000),
  content text NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 262144),
  revision bigint NOT NULL CHECK (revision > 0),
  title_revision bigint NOT NULL, description_revision bigint NOT NULL, content_revision bigint NOT NULL,
  created_at timestamptz(3) NOT NULL, modified_at timestamptz(3) NOT NULL,
  PRIMARY KEY(instance_id, account_id, id),
  FOREIGN KEY(instance_id, account_id) REFERENCES library(instance_id, account_id) ON DELETE CASCADE
);
CREATE INDEX prompt_browse ON prompt(instance_id, account_id, revision DESC, id);
CREATE TABLE library_operation (
  instance_id uuid NOT NULL, account_id text NOT NULL, operation_id uuid NOT NULL,
  epoch uuid NOT NULL, installation_id uuid NOT NULL, canonical_version integer NOT NULL,
  request_hash text NOT NULL, kind text NOT NULL, prompt_id uuid NOT NULL,
  revision bigint NOT NULL, accepted_at timestamptz(3) NOT NULL,
  PRIMARY KEY(instance_id, account_id, operation_id),
  UNIQUE(instance_id, account_id, prompt_id),
  FOREIGN KEY(instance_id, account_id) REFERENCES library(instance_id, account_id) ON DELETE CASCADE
);
CREATE TABLE library_change (
  instance_id uuid NOT NULL, account_id text NOT NULL, revision bigint NOT NULL,
  operation_id uuid NOT NULL, kind text NOT NULL, prompt_id uuid NOT NULL, accepted_at timestamptz(3) NOT NULL,
  PRIMARY KEY(instance_id, account_id, revision),
  FOREIGN KEY(instance_id, account_id, operation_id) REFERENCES library_operation(instance_id, account_id, operation_id) ON DELETE CASCADE
);
