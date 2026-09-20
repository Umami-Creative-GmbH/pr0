use super::library_contract::*;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub struct LibraryStore {
    db: Connection,
    instance: String,
    account: String,
}
fn io(_: rusqlite::Error) -> String {
    "storage_unavailable".into()
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
    pub fn open(root: &Path, instance: &str, account: &str) -> Result<Self, String> {
        let path = library_path(root, instance, account)?;
        if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("storage_unavailable".into());
        }
        let db = Connection::open(path).map_err(io)?;
        db.busy_timeout(std::time::Duration::from_millis(250))
            .map_err(io)?;
        let version: u32 = db
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(io)?;
        if version > 1 {
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
        if version == 0 {
            db.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1), instance TEXT NOT NULL, account TEXT NOT NULL);
                CREATE TABLE download(id TEXT PRIMARY KEY, manifest TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), active TEXT REFERENCES download(id), staging TEXT REFERENCES download(id));
                INSERT INTO state VALUES(1,NULL,NULL);
                CREATE TABLE organization(snapshot TEXT NOT NULL REFERENCES download(id) ON DELETE CASCADE, kind TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(snapshot,kind,id));
                CREATE TABLE prompt(snapshot TEXT NOT NULL REFERENCES download(id) ON DELETE CASCADE, id TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL, record TEXT NOT NULL, text_bytes INTEGER NOT NULL, PRIMARY KEY(snapshot,id));
                PRAGMA user_version=1;").map_err(io)?;
            db.execute(
                "INSERT INTO identity VALUES(1,?1,?2)",
                params![instance, account],
            )
            .map_err(io)?;
            db.execute_batch("COMMIT").map_err(io)?;
        }
        let valid: bool = db
            .query_row(
                "SELECT instance=?1 AND account=?2 FROM identity WHERE singleton=1",
                params![instance, account],
                |r| r.get(0),
            )
            .map_err(io)?;
        if !valid {
            return Err("snapshot_identity_mismatch".into());
        }
        Ok(Self {
            db,
            instance: instance.into(),
            account: account.into(),
        })
    }
    pub fn pending(&self) -> Result<Option<(Manifest, usize)>, String> {
        let row: Option<(String,u32)> = self.db.query_row("SELECT manifest,applied FROM download WHERE id=(SELECT staging FROM state WHERE singleton=1) AND complete=0", [], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(io)?;
        row.map(|(value, page)| {
            serde_json::from_str(&value)
                .map(|manifest| (manifest, page as usize))
                .map_err(|_| "storage_unavailable".into())
        })
        .transpose()
    }
    pub fn expire(&mut self) -> Result<(), String> {
        self.db
            .execute("UPDATE state SET staging=NULL WHERE singleton=1", [])
            .map_err(io)?;
        Ok(())
    }
    pub fn begin(&mut self, manifest: &Manifest) -> Result<(), String> {
        manifest.validate(&self.instance, &self.account)?;
        if manifest.expired() {
            return Err("snapshot_expired".into());
        }
        let value = serde_json::to_string(manifest).map_err(|_| "invalid_response")?;
        let tx = self.db.transaction().map_err(io)?;
        // At most one staging copy; the prior usable generation remains intact.
        tx.execute("UPDATE state SET staging=NULL WHERE singleton=1", [])
            .map_err(io)?;
        tx.execute("DELETE FROM download WHERE id NOT IN(SELECT active FROM state WHERE active IS NOT NULL)",[]).map_err(io)?;
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
        tx.commit().map_err(io)
    }
    pub fn apply(&mut self, manifest: &Manifest, index: usize, page: Page) -> Result<(), String> {
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
            let bytes = (p.title.len() + p.description.len() + p.content.len()) as i64;
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
        if complete {
            tx.execute(
                "UPDATE state SET active=?1,staging=NULL WHERE singleton=1",
                [&manifest.id],
            )
            .map_err(io)?;
            tx.execute("DELETE FROM download WHERE id<>?1", [&manifest.id])
                .map_err(io)?;
        }
        tx.commit().map_err(io)
    }
    pub fn status(&self) -> Result<LibraryStatus, String> {
        let row: Option<(String,u32,bool)> = self.db.query_row("SELECT manifest,applied,complete FROM download WHERE id=(SELECT coalesce(staging,active) FROM state)",[], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(io)?;
        let downloaded = self
            .db
            .query_row(
                "SELECT count(*) FROM prompt WHERE snapshot=(SELECT active FROM state)",
                [],
                |r| r.get(0),
            )
            .map_err(io)?;
        let mut status = LibraryStatus {
            complete: false,
            downloaded,
            total: 0,
            applied_pages: 0,
            total_pages: 0,
            revision: None,
            account_id: self.account.clone(),
            instance_id: self.instance.clone(),
        };
        if let Some((value, applied, complete)) = row {
            let manifest: Manifest =
                serde_json::from_str(&value).map_err(|_| "storage_unavailable")?;
            status.complete = complete;
            status.total = manifest.prompt_count;
            status.applied_pages = applied;
            status.total_pages = manifest.pages.len() as u32;
            status.revision = Some(manifest.revision);
        }
        Ok(status)
    }
    pub fn browse(&self, offset: u32) -> Result<Vec<Summary>, String> {
        if offset > 10000 {
            return Err("invalid_input".into());
        }
        let mut statement = self.db.prepare("SELECT id,title,archived FROM prompt WHERE snapshot=(SELECT active FROM state) ORDER BY id LIMIT 50 OFFSET ?1").map_err(io)?;
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
            .query_row(
                "SELECT record FROM prompt WHERE snapshot=(SELECT active FROM state) AND id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(io)?;
        serde_json::from_str(&value.ok_or("prompt_unavailable")?)
            .map_err(|_| "storage_unavailable".into())
    }
}
