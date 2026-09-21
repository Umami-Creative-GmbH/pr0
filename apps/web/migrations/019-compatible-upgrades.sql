-- Expand only: preserve protocol 1 and pr0-search-v1-ucd17 for all current
-- desktops. No entity, receipt, cursor or recovery epoch is rewritten here.
ALTER TABLE instance ADD COLUMN minimum_server_migration integer NOT NULL DEFAULT 19;
