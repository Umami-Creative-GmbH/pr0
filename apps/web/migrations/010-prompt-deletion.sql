-- Compact markers survive removal of prompt text and prevent identity resurrection.
CREATE TABLE prompt_deletion (
  instance_id uuid NOT NULL, account_id text NOT NULL, prompt_id uuid NOT NULL,
  revision bigint NOT NULL, deleted_at timestamptz(3) NOT NULL,
  PRIMARY KEY(instance_id, account_id, prompt_id),
  FOREIGN KEY(instance_id, account_id) REFERENCES library(instance_id, account_id) ON DELETE CASCADE
);
