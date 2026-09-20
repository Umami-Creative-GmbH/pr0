ALTER TABLE library_operation DROP CONSTRAINT library_operation_instance_id_account_id_prompt_id_key;
CREATE INDEX library_operation_prompt ON library_operation(instance_id, account_id, prompt_id);
ALTER TABLE prompt ADD COLUMN favorite boolean NOT NULL DEFAULT false;
ALTER TABLE prompt ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE prompt ADD COLUMN use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0);
ALTER TABLE prompt ADD COLUMN last_used_at timestamptz(3);
ALTER TABLE library_operation ADD COLUMN conflict_copy_id uuid;
ALTER TABLE library_operation ADD COLUMN conflict_notice_id uuid;
CREATE TABLE conflict_notice (
  instance_id uuid NOT NULL, account_id text NOT NULL, id uuid NOT NULL,
  original_id uuid NOT NULL, copy_id uuid NOT NULL, source_title text NOT NULL,
  revision bigint NOT NULL, created_at timestamptz(3) NOT NULL, reviewed_at timestamptz(3),
  PRIMARY KEY(instance_id, account_id, id),
  FOREIGN KEY(instance_id, account_id) REFERENCES library(instance_id, account_id) ON DELETE CASCADE
);
CREATE INDEX conflict_notice_review ON conflict_notice(instance_id, account_id, revision DESC, id) WHERE reviewed_at IS NULL;
-- A rejected write retains only its canonical hash, allowing exact retries without permitting payload replacement.
CREATE TABLE library_operation_attempt (
  instance_id uuid NOT NULL, account_id text NOT NULL, operation_id uuid NOT NULL,
  request_hash text NOT NULL,
  PRIMARY KEY(instance_id, account_id, operation_id),
  FOREIGN KEY(instance_id, account_id) REFERENCES library(instance_id, account_id) ON DELETE CASCADE
);
