-- Retain membership removals after the live organization identity disappears.
ALTER TABLE prompt_tag DROP CONSTRAINT prompt_tag_instance_id_account_id_tag_id_fkey;
-- Distinguish alias redirection from a user's membership removal for remove-wins.
ALTER TABLE prompt_tag ADD COLUMN merge_revision bigint NOT NULL DEFAULT 0;
CREATE TABLE organization_removed (
  instance_id uuid NOT NULL, account_id text NOT NULL, id uuid NOT NULL,
  entity text NOT NULL CHECK (entity IN ('collection', 'tag')),
  name text NOT NULL, revision bigint NOT NULL,
  target_id uuid,
  PRIMARY KEY(instance_id, account_id, id),
  CHECK (target_id IS NULL OR (entity = 'tag' AND target_id <> id)),
  FOREIGN KEY(instance_id, account_id) REFERENCES library(instance_id, account_id) ON DELETE CASCADE
);
ALTER TABLE library_operation ADD COLUMN organization_effect jsonb;
ALTER TABLE library_change ADD COLUMN organization_effect jsonb;
CREATE TABLE organization_affected (
  instance_id uuid NOT NULL, account_id text NOT NULL, operation_id uuid NOT NULL,
  prompt_id uuid NOT NULL, originally_archived boolean NOT NULL,
  PRIMARY KEY(instance_id, account_id, operation_id, prompt_id),
  FOREIGN KEY(instance_id, account_id, operation_id) REFERENCES library_operation(instance_id, account_id, operation_id) ON DELETE CASCADE
);
