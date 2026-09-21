// Epoch recovery retains the pre-refresh baseline, visible saved variants and pending identities
// in the account's SQLite partition. Archived records never become automatic upload operations.
fn reconcile_replacement_overlays(tx: &rusqlite::Transaction, manifest: &Manifest) -> Result<(), String> {
    let mut statement = tx.prepare("SELECT l.record,p.record FROM local_prompt l JOIN prompt p ON p.id=l.id AND p.snapshot=?1 WHERE l.id NOT IN(SELECT prompt_id FROM recovery_blocked)").map_err(io)?;
    let mut rows = statement.query([&manifest.id]).map_err(io)?;
    while let Some(row) = rows.next().map_err(io)? {
        let saved: Prompt = serde_json::from_str(&row.get::<_,String>(0).map_err(io)?).map_err(|_|"storage_unavailable")?;
        let mut current: Prompt = serde_json::from_str(&row.get::<_,String>(1).map_err(io)?).map_err(|_|"storage_unavailable")?;
        current.title = saved.title;
        current.description = saved.description;
        current.content = saved.content;
        current.modified_at = saved.modified_at;
        store_overlay_prompt(tx, &current)?;
    }
    Ok(())
}

fn preserve_recovery_epoch(tx: &rusqlite::Transaction, next: &Manifest) -> Result<(), String> {
    let prior: Option<String> = tx.query_row(
        "SELECT manifest FROM download WHERE id=(SELECT active FROM state)", [], |r|r.get(0)
    ).optional().map_err(io)?;
    let Some(prior) = prior else { return Ok(()); };
    let prior: Manifest = serde_json::from_str(&prior).map_err(|_|"storage_unavailable")?;
    if prior.epoch == next.epoch { return Ok(()); }
    let added = tx.execute("INSERT OR IGNORE INTO recovery_archive VALUES(?1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))", [&prior.id]).map_err(io)?;
    if added > 0 {
        tx.execute("INSERT INTO recovery_prompt SELECT ?1,id,record FROM visible_prompt", [&prior.id]).map_err(io)?;
        tx.execute("INSERT INTO recovery_work SELECT ?1,id,'prompt',json_object('payload',payload,'envelope',envelope,'receipt',receipt,'state',state) FROM outbox", [&prior.id]).map_err(io)?;
        tx.execute("INSERT INTO recovery_work SELECT ?1,id,'usage',json_object('promptId',prompt_id,'occurredAt',occurred_at,'envelope',envelope,'receipt',receipt) FROM pending_usage", [&prior.id]).map_err(io)?;
        tx.execute("INSERT INTO recovery_work SELECT ?1,id,'organization',json_object('payload',payload,'envelope',envelope,'receipt',receipt) FROM organization_queue", [&prior.id]).map_err(io)?;
    }
    tx.execute("INSERT OR IGNORE INTO recovery_blocked SELECT prompt_id FROM outbox", []).map_err(io)?;
    tx.execute("UPDATE outbox SET error='recovery_required',next_attempt=9223372036854775807", []).map_err(io)?;
    tx.execute("UPDATE pending_usage SET recovery=1", []).map_err(io)?;
    tx.execute("UPDATE organization_queue SET error='recovery_required',next_attempt=9223372036854775807", []).map_err(io)?;
    Ok(())
}

impl LibraryStore {
    fn preflight_snapshot(&self, manifest: &Manifest) -> Result<(), String> {
        #[cfg(test)]
        if TEST_FAULT.with(|value| value.borrow().as_str() == "scratch_space") {
            return Err("insufficient_scratch_space".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            let directory = Path::new(self.db.path().ok_or("storage_unavailable")?).parent().ok_or("storage_unavailable")?;
            let path: Vec<u16> = directory.as_os_str().encode_wide().chain(Some(0)).collect();
            let mut available = 0_u64;
            // This is an advisory preflight. SQLite FULL/WAL transactions still protect writes
            // if another process consumes the free space after the check.
            if unsafe { windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(path.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) } == 0 {
                return Err("storage_unavailable".into());
            }
            let database_bytes: i64 = self.db.query_row("SELECT page_count*page_size FROM pragma_page_count(),pragma_page_size()", [], |r|r.get(0)).map_err(io)?;
            let wire_bytes: u64 = manifest.pages.iter().map(|page|page.bytes as u64).sum();
            let required = wire_bytes.saturating_mul(4).saturating_add((database_bytes as u64).saturating_mul(2)).saturating_add(16*1024*1024);
            if available < required { return Err("insufficient_scratch_space".into()); }
        }
        #[cfg(not(windows))]
        let _ = manifest; // SQLite's atomic disk-full handling remains effective on non-Windows hosts.
        Ok(())
    }
    pub fn recovery_browse(&self, offset: u32) -> Result<Vec<RecoverySummary>, String> {
        let mut statement = self.db.prepare("SELECT p.snapshot,p.id,json_extract(p.record,'$.title'),a.captured_at FROM recovery_prompt p JOIN recovery_archive a ON a.snapshot=p.snapshot ORDER BY a.captured_at DESC,p.snapshot,p.id LIMIT 50 OFFSET ?1").map_err(io)?;
        let result = statement.query_map([offset], |r|Ok(RecoverySummary {snapshot_id:r.get(0)?,prompt_id:r.get(1)?,title:r.get(2)?,captured_at:r.get(3)?})).map_err(io)?.collect::<Result<Vec<_>,_>>().map_err(io)?;
        Ok(result)
    }
    pub fn recovery_detail(&self, snapshot: &str, id: &str) -> Result<Prompt, String> {
        let value: Option<String> = self.db.query_row("SELECT record FROM recovery_prompt WHERE snapshot=?1 AND id=?2", params![snapshot,id], |r|r.get(0)).optional().map_err(io)?;
        serde_json::from_str(&value.ok_or("prompt_unavailable")?).map_err(|_|"storage_unavailable".into())
    }
    pub fn pause_download(&self, paused: bool) -> Result<(), String> {
        if paused && self.status()?.complete { return Ok(()); }
        self.db.execute("UPDATE recovery_state SET paused=?1", [paused]).map_err(io)?;
        Ok(())
    }
    pub fn download_result(&self, error: Option<&str>) -> Result<(), String> {
        self.db.execute("UPDATE recovery_state SET error=?1", [error]).map_err(io)?;
        Ok(())
    }
    pub fn recovering(&self) -> Result<bool, String> {
        self.db.query_row("SELECT required OR EXISTS(SELECT 1 FROM state WHERE staging IS NOT NULL) FROM recovery_state", [], |r|r.get(0)).map_err(io)
    }
    pub fn active_epoch(&self) -> Result<Option<String>, String> {
        self.db.query_row("SELECT json_extract(manifest,'$.epoch') FROM download WHERE id=(SELECT active FROM state)", [], |r|r.get(0)).optional().map_err(io)
    }
}
