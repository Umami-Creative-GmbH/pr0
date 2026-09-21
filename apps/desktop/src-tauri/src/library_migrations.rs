use super::library_storage::io;
use rusqlite::{params, Connection, TransactionBehavior};
use std::path::Path;

pub const CURRENT_SCHEMA: u32 = 10;

pub fn migrate(
    db: &mut Connection,
    path: &Path,
    instance: &str,
    account: &str,
) -> Result<(), String> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(io)?;
    let version: u32 = tx
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(io)?;
    if version > CURRENT_SCHEMA {
        return Err("local_update_required".into());
    }
    if version > 0 {
        let valid: bool = tx
            .query_row(
                "SELECT instance=?1 AND account=?2 FROM identity WHERE singleton=1",
                params![instance, account],
                |r| r.get(0),
            )
            .map_err(io)?;
        if !valid {
            return Err("snapshot_identity_mismatch".into());
        }
    }
    if version > 0 && version < CURRENT_SCHEMA {
        super::migration_backup::prepare(&tx, path, version)?;
    }
    if version == 0 {
        tx.execute_batch("
                CREATE TABLE identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1), instance TEXT NOT NULL, account TEXT NOT NULL);
                CREATE TABLE download(id TEXT PRIMARY KEY, manifest TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), active TEXT REFERENCES download(id), staging TEXT REFERENCES download(id));
                INSERT INTO state VALUES(1,NULL,NULL);
                CREATE TABLE organization(snapshot TEXT NOT NULL REFERENCES download(id) ON DELETE CASCADE, kind TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(snapshot,kind,id));
                CREATE TABLE prompt(snapshot TEXT NOT NULL REFERENCES download(id) ON DELETE CASCADE, id TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL, record TEXT NOT NULL, text_bytes INTEGER NOT NULL, PRIMARY KEY(snapshot,id));
                PRAGMA user_version=1;").map_err(io)?;
        tx.execute(
            "INSERT INTO identity VALUES(1,?1,?2)",
            params![instance, account],
        )
        .map_err(io)?;
    }
    if version < 2 {
        tx.execute_batch("
                ALTER TABLE download ADD COLUMN text_bytes INTEGER NOT NULL DEFAULT 0;
                CREATE TABLE local_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0), installation TEXT NOT NULL);
                CREATE TABLE local_prompt(id TEXT PRIMARY KEY,title TEXT NOT NULL,archived INTEGER NOT NULL,record TEXT NOT NULL,text_bytes INTEGER NOT NULL);
                CREATE TABLE outbox(id TEXT PRIMARY KEY,prompt_id TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('unsent','in_flight','accepted_awaiting_download')),local_revision INTEGER NOT NULL);
                CREATE INDEX outbox_prompt ON outbox(prompt_id,local_revision);
                CREATE TABLE local_receipt(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL);
                CREATE VIEW visible_prompt AS SELECT id,title,archived,record,text_bytes FROM local_prompt UNION ALL SELECT id,title,archived,record,text_bytes FROM prompt WHERE snapshot=(SELECT active FROM state) AND id NOT IN(SELECT id FROM local_prompt);
                PRAGMA user_version=2;").map_err(io)?;
        tx.execute(
            "INSERT INTO local_state VALUES(1,0,?1)",
            [uuid::Uuid::new_v4().to_string()],
        )
        .map_err(io)?;
        super::local_search::migrate(&tx).map_err(io)?;
    }
    if version < 3 {
        tx.execute_batch("
                ALTER TABLE outbox ADD COLUMN envelope TEXT;
                ALTER TABLE outbox ADD COLUMN receipt TEXT;
                ALTER TABLE outbox ADD COLUMN error TEXT;
                ALTER TABLE outbox ADD COLUMN next_attempt INTEGER NOT NULL DEFAULT 0;
                CREATE TABLE upload_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT, refresh INTEGER NOT NULL DEFAULT 0, last_checked TEXT);
                INSERT INTO upload_state(singleton) VALUES(1);
                CREATE TABLE prompt_mapping(original TEXT PRIMARY KEY, copy TEXT NOT NULL, operation TEXT NOT NULL);
                PRAGMA user_version=3;
                ").map_err(io)?;
    }
    if version < 4 {
        tx.execute_batch("
                CREATE TABLE pending_usage(id TEXT PRIMARY KEY,prompt_id TEXT NOT NULL,occurred_at TEXT NOT NULL,envelope TEXT,receipt TEXT);
                CREATE INDEX usage_prompt ON pending_usage(prompt_id);
                CREATE TABLE usage_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,error TEXT);
                INSERT INTO usage_state(singleton) VALUES(1);
                PRAGMA user_version=4; ").map_err(io)?;
    }
    if version < 5 {
        tx.execute_batch("
                CREATE TABLE change_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), cursor TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT, updating INTEGER NOT NULL DEFAULT 1);
                INSERT INTO change_state(singleton) VALUES(1);
                UPDATE upload_state SET last_checked=NULL;
                PRAGMA user_version=5; ").map_err(io)?;
    }

    // Earlier branches reused versions 6 and 7 for different feature combinations.
    // Inspect the schema so either existing database upgrades without losing work.
    let has_recovery: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='recovery_state')", [], |r| r.get(0)).map_err(io)?;
    if version < 8 && !has_recovery {
        tx.execute_batch("
                CREATE TABLE recovery_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), required INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0, error TEXT);
                INSERT INTO recovery_state(singleton) VALUES(1);
                CREATE TABLE recovery_archive(snapshot TEXT PRIMARY KEY REFERENCES download(id), captured_at TEXT NOT NULL);
                CREATE TABLE recovery_prompt(snapshot TEXT NOT NULL REFERENCES recovery_archive(snapshot), id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(snapshot,id));
                CREATE TABLE recovery_work(snapshot TEXT NOT NULL REFERENCES recovery_archive(snapshot), id TEXT NOT NULL, kind TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(snapshot,id));
                CREATE TABLE recovery_blocked(prompt_id TEXT PRIMARY KEY);
                ALTER TABLE pending_usage ADD COLUMN recovery INTEGER NOT NULL DEFAULT 0;
                UPDATE recovery_state SET required=EXISTS(SELECT 1 FROM change_state WHERE error='snapshot_required');
                PRAGMA user_version=6;").map_err(io)?;
    }
    if version < 8 {
        let has_organization: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='organization_queue')", [], |r| r.get(0)).map_err(io)?;
        if !has_organization {
            super::library_storage::migrate_organization(&tx)?;
        }
        let indexed: bool = tx
            .query_row(
                "SELECT version=2 FROM local_search_version WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .map_err(io)?;
        if !indexed {
            super::local_search::upgrade(&tx).map_err(io)?;
        }
        super::local_search::integrate_organization(&tx).map_err(io)?;
    }

    if version < 9 {
        tx.execute_batch("CREATE TABLE IF NOT EXISTS local_deleted(id TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS local_identity(id TEXT PRIMARY KEY);
            INSERT OR IGNORE INTO local_identity SELECT id FROM local_prompt;
            DROP VIEW base_visible_prompt;
            CREATE VIEW base_visible_prompt AS SELECT id,title,archived,record,text_bytes FROM local_prompt WHERE id NOT IN(SELECT id FROM local_deleted) UNION ALL SELECT id,title,archived,record,text_bytes FROM prompt WHERE snapshot=(SELECT active FROM state) AND id NOT IN(SELECT id FROM local_prompt) AND id NOT IN(SELECT id FROM local_deleted);
            CREATE TRIGGER IF NOT EXISTS search_deleted_insert AFTER INSERT ON local_deleted BEGIN INSERT INTO search_dirty VALUES(NEW.id,1) ON CONFLICT(id) DO UPDATE SET text_changed=1; END;
            CREATE TRIGGER IF NOT EXISTS search_deleted_delete AFTER DELETE ON local_deleted BEGIN INSERT INTO search_dirty VALUES(OLD.id,1) ON CONFLICT(id) DO UPDATE SET text_changed=1; END;
            INSERT INTO search_dirty SELECT id,1 FROM local_deleted WHERE true ON CONFLICT(id) DO UPDATE SET text_changed=1;
            PRAGMA user_version=9;").map_err(io)?;
        super::local_search::flush(&tx).map_err(io)?;
    }

    if version < 10 {
        tx.execute_batch("CREATE TABLE attention_staging(kind TEXT NOT NULL,id TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(kind,id));").map_err(io)?;
        tx.execute_batch("ALTER TABLE organization_queue ADD COLUMN failure TEXT;").map_err(io)?;
        tx.execute_batch("CREATE TABLE organization_adjustment(id TEXT PRIMARY KEY,record TEXT NOT NULL,reviewed INTEGER NOT NULL DEFAULT 0);").map_err(io)?;
        tx.execute_batch("ALTER TABLE outbox ADD COLUMN failure TEXT;").map_err(io)?;
        tx.execute_batch("CREATE TABLE conflict_notice(id TEXT PRIMARY KEY,record TEXT NOT NULL,reviewed INTEGER NOT NULL DEFAULT 0); CREATE TABLE conflict_reviewed(id TEXT PRIMARY KEY); CREATE TABLE conflict_state(error TEXT,adjustment_error TEXT); INSERT INTO conflict_state VALUES(NULL,NULL); PRAGMA user_version=10;").map_err(io)?;
    }
    #[cfg(test)]
    checkpoint(&tx)?;
    tx.commit().map_err(io)
}

#[cfg(test)]
thread_local! { pub static FAULT: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) }; }
#[cfg(test)]
fn checkpoint(tx: &rusqlite::Transaction) -> Result<(), String> {
    use std::io::Write;
    if std::env::var_os("PR0_MIGRATION_KILL_WORKER").is_some() {
        println!("MIGRATION_STAGED");
        std::io::stdout().flush().unwrap();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }
    let fault = FAULT.with(|value| value.borrow().clone());
    if fault == "io" {
        return Err("storage_unavailable".into());
    }
    if fault == "full" {
        let pages: u32 = tx
            .query_row("PRAGMA page_count", [], |r| r.get(0))
            .map_err(io)?;
        tx.pragma_update(None, "max_page_count", pages)
            .map_err(io)?;
        tx.execute_batch("CREATE TABLE migration_full_probe(value BLOB);")
            .map_err(io)?;
        tx.execute(
            "INSERT INTO migration_full_probe VALUES(zeroblob(?1))",
            [i64::from(pages) * 65536],
        )
        .map_err(io)?;
    }
    Ok(())
}
