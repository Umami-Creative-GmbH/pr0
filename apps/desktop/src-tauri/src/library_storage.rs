use super::library_contract::*;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub struct LibraryStore {
    db: Connection,
    instance: String,
    account: String,
    recovery_error: Option<String>,
}
pub(crate) fn io(error: rusqlite::Error) -> String {
    match error.sqlite_error_code() {
        Some(rusqlite::ErrorCode::DiskFull) => "disk_full",
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked) => {
            "storage_busy"
        }
        _ => "storage_unavailable",
    }
    .into()
}
pub fn library_path(root: &Path, instance: &str, account: &str) -> Result<PathBuf, String> {
    let instance = uuid::Uuid::parse_str(instance).map_err(|_| "retained_identity_invalid")?;
    let account = uuid::Uuid::parse_str(account).map_err(|_| "retained_identity_invalid")?;
    Ok(root.join(format!(
        "library-{}-{}.sqlite",
        instance.hyphenated(),
        account.hyphenated()
    )))
}
impl LibraryStore {
    pub fn recover_search(&mut self) -> Result<(), String> {
        super::local_search::rebuild(&mut self.db).map_err(|error| {
            if error.sqlite_error_code() == Some(rusqlite::ErrorCode::DiskFull) {
                io(error)
            } else {
                "search_recovery_required".into()
            }
        })?;
        self.recovery_error = None;
        Ok(())
    }
    pub fn search(
        &mut self,
        request: &super::search_contract::SearchRequest,
        cancelled: &impl Fn() -> bool,
    ) -> Result<super::search_contract::SearchPage, String> {
        let tx = self.db.transaction().map_err(io)?;
        let result = super::search_query::search(&tx, request, cancelled)?;
        tx.commit().map_err(io)?;
        Ok(result)
    }
    pub fn open(root: &Path, instance: &str, account: &str) -> Result<Self, String> {
        let path = library_path(root, instance, account)?;
        if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("storage_unavailable".into());
        }
        let mut db = Connection::open(&path).map_err(io)?;
        db.busy_timeout(std::time::Duration::from_millis(250))
            .map_err(io)?;
        let version: u32 = db
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(io)?;
        if version > super::library_migrations::CURRENT_SCHEMA {
            return Err("local_update_required".into());
        }
        db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
        )
        .map_err(io)?;
        let mode: String = db
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .map_err(io)?;
        let full: u32 = db
            .query_row("PRAGMA synchronous", [], |r| r.get(0))
            .map_err(io)?;
        let foreign: u32 = db
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .map_err(io)?;
        if mode != "wal" || full != 2 || foreign != 1 {
            return Err("storage_unavailable".into());
        }
        super::library_migrations::migrate(&mut db, &path, instance, account)?;
        let recovery_error = super::local_search::recover(&mut db, &path).err();
        db.execute_batch("PRAGMA cache_size=-65536; PRAGMA mmap_size=0;")
            .map_err(io)?;
        Ok(Self {
            db,
            recovery_error,
            instance: instance.into(),
            account: account.into(),
        })
    }
    pub fn pending(&self) -> Result<Option<(Manifest, usize)>, String> {
        let row: Option<(String,u32)> = self.db.query_row("SELECT manifest,applied FROM download WHERE id=(SELECT staging FROM state WHERE singleton=1)", [], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(io)?;
        row.map(|(value, page)| {
            serde_json::from_str(&value)
                .map(|manifest| (manifest, page as usize))
                .map_err(|_| "storage_unavailable".into())
        })
        .transpose()
    }
    pub fn expire(&mut self) -> Result<(), String> {
        self.db
            .execute_batch("BEGIN IMMEDIATE; UPDATE state SET staging=NULL WHERE singleton=1; UPDATE recovery_state SET required=1; COMMIT;")
            .map_err(io)?;
        Ok(())
    }
    pub fn begin(&mut self, manifest: &Manifest) -> Result<(), String> {
        manifest.validate(&self.instance, &self.account)?;
        if manifest.expired() {
            return Err("snapshot_expired".into());
        }
        let value = serde_json::to_string(manifest).map_err(|_| "invalid_response")?;
        self.preflight_snapshot(manifest)?;
        let tx = self.db.transaction().map_err(io)?;
        preserve_recovery_epoch(&tx, manifest)?;
        // At most one staging copy; the prior usable generation remains intact.
        tx.execute("UPDATE state SET staging=NULL WHERE singleton=1", [])
            .map_err(io)?;
        tx.execute("DELETE FROM download WHERE id NOT IN(SELECT active FROM state WHERE active IS NOT NULL) AND id NOT IN(SELECT snapshot FROM recovery_archive)",[]).map_err(io)?;
        tx.execute(
            "INSERT INTO download(id,manifest) VALUES(?1,?2)",
            params![manifest.id, value],
        )
        .map_err(io)?;
        tx.execute(
            "UPDATE state SET active=coalesce(active,?1),staging=?1 WHERE singleton=1",
            [&manifest.id],
        )
        .map_err(io)?;
        tx.execute(
            "UPDATE change_state SET cursor=NULL,error=NULL,next_attempt=0,attempts=0,updating=1",
            [],
        )
        .map_err(io)?;
        tx.execute(
            "UPDATE outbox SET error=NULL,next_attempt=0 WHERE error='snapshot_required'",
            [],
        )
        .map_err(io)?;
        commit_search(tx)
    }
    pub fn apply(&mut self, manifest: &Manifest, index: usize, page: Page) -> Result<(), String> {
        if manifest.expired() {
            return Err("snapshot_expired".into());
        }
        let expected = manifest.pages.get(index).ok_or("invalid_response")?;
        let digest = format!("{:x}", Sha256::digest(page.payload.as_bytes()));
        if page.id != manifest.id
            || page.page != index
            || page.payload.len() != expected.bytes
            || digest != expected.digest
        {
            return Err("snapshot_digest_mismatch".into());
        }
        let records: Records =
            serde_json::from_str(&page.payload).map_err(|_| "invalid_response")?;
        records.validate(manifest, index)?;
        let tx = self.db.transaction().map_err(io)?;
        let applied: u32 = tx
            .query_row(
                "SELECT applied FROM download WHERE id=?1 AND id=(SELECT staging FROM state)",
                [&manifest.id],
                |r| r.get(0),
            )
            .map_err(io)?;
        if applied as usize != index {
            return Err("operation_cancelled".into());
        }
        if let Some(org) = records.organization {
            tx.execute(
                "UPDATE download SET text_bytes=?2 WHERE id=?1",
                params![manifest.id, org.text_bytes as i64],
            )
            .map_err(io)?;
            for (kind, entries) in [("collection", org.collections), ("tag", org.tags)] {
                for entry in entries {
                    tx.execute(
                        "INSERT INTO organization VALUES(?1,?2,?3,?4,?5)",
                        params![
                            manifest.id,
                            kind,
                            entry.id,
                            entry.name,
                            serde_json::to_string(&entry).map_err(|_| "invalid_response")?
                        ],
                    )
                    .map_err(io)?;
                }
            }
        }
        for p in records.prompts {
            for (kind, id) in p
                .collection_id
                .iter()
                .map(|id| ("collection", id))
                .chain(p.tag_ids.iter().map(|id| ("tag", id)))
            {
                let found: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM organization WHERE snapshot=?1 AND kind=?2 AND id=?3)",params![manifest.id,kind,id], |r|r.get(0)).map_err(io)?;
                if !found {
                    return Err("invalid_response".into());
                }
            }
            let bytes = (p.title.len()
                + p.description.len()
                + p.content.len()
                + p.source_title.as_ref().map_or(0, String::len)) as i64;
            tx.execute(
                "INSERT INTO prompt VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    manifest.id,
                    p.id,
                    p.title,
                    p.archived,
                    serde_json::to_string(&p).map_err(|_| "invalid_response")?,
                    bytes
                ],
            )
            .map_err(io)?;
        }
        let count: u32 = tx
            .query_row(
                "SELECT count(*) FROM prompt WHERE snapshot=?1",
                [&manifest.id],
                |r| r.get(0),
            )
            .map_err(io)?;
        let complete = index + 1 == manifest.pages.len();
        let bytes:i64 = tx.query_row("SELECT coalesce((SELECT sum(text_bytes) FROM prompt WHERE snapshot=?1),0)+coalesce((SELECT sum(length(cast(name AS BLOB))) FROM organization WHERE snapshot=?1),0)",[&manifest.id],|r|r.get(0)).map_err(io)?;
        if bytes > 104857600 {
            return Err("invalid_response".into());
        }
        if count > manifest.prompt_count || (complete && count != manifest.prompt_count) {
            return Err("invalid_response".into());
        }
        tx.execute(
            "UPDATE download SET applied=?2,complete=?3 WHERE id=?1",
            params![manifest.id, (index + 1) as u32, complete],
        )
        .map_err(io)?;
        let initial: bool = tx
            .query_row("SELECT active=staging FROM state", [], |r| r.get(0))
            .map_err(io)?;
        if complete && initial {
            retire_downloaded_uploads(&tx, manifest)?;
            tx.execute("UPDATE change_state SET cursor=NULL,updating=1", [])
                .map_err(io)?;
            tx.execute(
                "UPDATE state SET active=?1,staging=NULL WHERE singleton=1",
                [&manifest.id],
            )
            .map_err(io)?;
            tx.execute("DELETE FROM download WHERE id<>?1 AND id NOT IN(SELECT snapshot FROM recovery_archive)", [&manifest.id])
                .map_err(io)?;
            tx.execute("UPDATE recovery_state SET required=0", [])
                .map_err(io)?;
        }
        tx.execute("UPDATE local_state SET revision=revision+1", [])
            .map_err(io)?;
        project_organization(&tx)?;
        #[cfg(test)]
        test_stage("snapshot_page_commit")?;
        commit_search(tx)
    }
    pub fn status(&self) -> Result<LibraryStatus, String> {
        let row: Option<(String,u32,bool)> = self.db.query_row("SELECT manifest,applied,complete FROM download WHERE id=(SELECT coalesce(staging,active) FROM state)",[], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(io)?;
        let downloaded = self
            .db
            .query_row("SELECT count(*) FROM visible_prompt", [], |r| r.get(0))
            .map_err(io)?;
        let mut status = LibraryStatus {
            recovery_error: self.recovery_error.clone(),
            replacement: self.db.query_row("SELECT EXISTS(SELECT 1 FROM download WHERE id=(SELECT active FROM state) AND complete=1) AND ((SELECT required FROM recovery_state) OR EXISTS(SELECT 1 FROM state WHERE staging IS NOT NULL))", [], |r|r.get(0)).map_err(io)?,
            catching_up: self.db.query_row("SELECT EXISTS(SELECT 1 FROM download WHERE id=(SELECT staging FROM state) AND complete=1)", [], |r|r.get(0)).map_err(io)?,
            paused: self.db.query_row("SELECT paused FROM recovery_state", [], |r|r.get(0)).map_err(io)?,
            error: self.db.query_row("SELECT error FROM recovery_state", [], |r|r.get(0)).map_err(io)?,
            recovery_count: self.db.query_row("SELECT count(*) FROM recovery_prompt", [], |r|r.get(0)).map_err(io)?,
            complete: false,
            downloaded,
            total: 0,
            applied_pages: 0,
            total_pages: 0,
            revision: None,
            account_id: self.account.clone(),
            instance_id: self.instance.clone(),
            pending_changes: self.pending_count()?,
            text_bytes: self.known_usage()?.1 as u64,
        };
        if let Some((value, applied, complete)) = row {
            let manifest: Manifest =
                serde_json::from_str(&value).map_err(|_| "storage_unavailable")?;
            let recovering = self.recovering()?;
            status.complete = complete && !recovering;
            status.total = manifest.prompt_count;
            status.applied_pages = applied;
            status.total_pages = manifest.pages.len() as u32;
            status.revision = Some(manifest.revision);
        }
        Ok(status)
    }
    pub fn browse(&self, offset: u32) -> Result<Vec<Summary>, String> {
        if offset > 20000 {
            return Err("invalid_input".into());
        }
        let mut statement = self
            .db
            .prepare("SELECT id,title,archived FROM visible_prompt ORDER BY id LIMIT 50 OFFSET ?1")
            .map_err(io)?;
        let result = statement
            .query_map([offset], |r| {
                Ok(Summary {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    archived: r.get(2)?,
                })
            })
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        Ok(result)
    }
    pub fn detail(&self, id: &str) -> Result<Prompt, String> {
        if !super::auth_contract::valid_id(id) {
            return Err("invalid_input".into());
        }
        let value: Option<String> = self
            .db
            .query_row("SELECT record FROM visible_prompt WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(io)?;
        let mut prompt: Prompt = serde_json::from_str(&value.ok_or("prompt_unavailable")?)
            .map_err(|_| "storage_unavailable")?;
        self.project_usage(&mut prompt)?;
        Ok(prompt)
    }
}
include!("local_storage.rs");
fn commit_search(tx: rusqlite::Transaction<'_>) -> Result<(), String> {
    super::local_search::flush(&tx).map_err(|_| "search_recovery_required".to_string())?;
    tx.commit().map_err(io)
}
include!("upload_storage.rs");
include!("change_storage.rs");
include!("usage_storage.rs");
include!("organization_storage.rs");
include!("recovery_storage.rs");
