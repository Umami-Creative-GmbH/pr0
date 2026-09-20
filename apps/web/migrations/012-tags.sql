ALTER TABLE library ADD COLUMN tag_count integer NOT NULL DEFAULT 0 CHECK (tag_count BETWEEN 0 AND 1000);
CREATE TABLE tag (
  instance_id uuid NOT NULL, account_id text NOT NULL, id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  identity_key text COLLATE "C" NOT NULL, revision bigint NOT NULL,
  PRIMARY KEY(instance_id, account_id, id),
  UNIQUE(instance_id, account_id, identity_key),
  FOREIGN KEY(instance_id, account_id) REFERENCES library(instance_id, account_id) ON DELETE CASCADE
);
ALTER TABLE library_operation ADD COLUMN tag_id uuid;
ALTER TABLE library_operation ADD COLUMN resolved_tag_id uuid;
ALTER TABLE library_operation ADD COLUMN tag_outcome text CHECK (tag_outcome IN ('created', 'existing', 'renamed'));
ALTER TABLE library_change ADD COLUMN tag_id uuid;
-- Membership tombstones remain until account deletion, including after prompt deletion.
CREATE TABLE prompt_tag (
  instance_id uuid NOT NULL, account_id text NOT NULL, prompt_id uuid NOT NULL, tag_id uuid NOT NULL,
  add_revision bigint NOT NULL DEFAULT 0, remove_revision bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(instance_id, account_id, prompt_id, tag_id),
  FOREIGN KEY(instance_id, account_id) REFERENCES library(instance_id, account_id) ON DELETE CASCADE,
  FOREIGN KEY(instance_id, account_id, tag_id) REFERENCES tag(instance_id, account_id, id)
);
CREATE INDEX prompt_tag_active ON prompt_tag(instance_id, account_id, tag_id, prompt_id) WHERE add_revision > remove_revision;
