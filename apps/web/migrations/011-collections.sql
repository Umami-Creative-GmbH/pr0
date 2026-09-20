ALTER TABLE library ADD COLUMN collection_count integer NOT NULL DEFAULT 0 CHECK (collection_count BETWEEN 0 AND 200);
CREATE TABLE collection (
  instance_id uuid NOT NULL, account_id text NOT NULL, id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  identity_key text COLLATE "C" NOT NULL,
  revision bigint NOT NULL,
  PRIMARY KEY(instance_id, account_id, id),
  UNIQUE(instance_id, account_id, identity_key),
  FOREIGN KEY(instance_id, account_id) REFERENCES library(instance_id, account_id) ON DELETE CASCADE
);
ALTER TABLE prompt ADD COLUMN collection_id uuid;
ALTER TABLE prompt ADD COLUMN collection_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE prompt ADD FOREIGN KEY(instance_id, account_id, collection_id) REFERENCES collection(instance_id, account_id, id);
CREATE INDEX prompt_collection ON prompt(instance_id, account_id, collection_id, archived);
ALTER TABLE library_operation ALTER COLUMN prompt_id DROP NOT NULL;
ALTER TABLE library_operation ADD COLUMN collection_id uuid;
ALTER TABLE library_operation ADD COLUMN organization_notice text;
ALTER TABLE library_change ALTER COLUMN prompt_id DROP NOT NULL;
ALTER TABLE library_change ADD COLUMN collection_id uuid;
