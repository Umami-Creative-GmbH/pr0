ALTER TABLE prompt ADD COLUMN favorite_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE prompt ADD COLUMN archived_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE prompt ADD COLUMN source_title text;
