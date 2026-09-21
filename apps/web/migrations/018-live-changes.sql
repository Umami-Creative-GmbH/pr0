-- Existing rows have no historical record image: old cursors explicitly require recovery.
ALTER TABLE library_change ADD COLUMN payload text;
CREATE INDEX library_change_retention ON library_change(accepted_at);
