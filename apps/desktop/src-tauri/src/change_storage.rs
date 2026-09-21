// Included in library_storage: the cursor, baseline, overlays and projection revision commit together.
use super::change_contract::{ChangePage, ChangeStatus};
impl LibraryStore {
    pub fn change_status(&self) -> Result<ChangeStatus, String> {
        self.db.query_row("SELECT error,next_attempt,updating,(SELECT last_checked FROM upload_state) FROM change_state", [], |r| {
            let next: i64 = r.get(1)?;
            Ok(ChangeStatus { error: r.get(0)?, retry_after_ms: next.saturating_sub(now()).max(0) as u64, updating: r.get(2)?, last_checked_at: r.get(3)? })
        }).map_err(io)
    }
    pub fn change_request(&self, wait: u32) -> Result<Option<serde_json::Value>, String> {
        if self.status()?.paused { return Ok(None); }
        let status = self.change_status()?;
        if status.retry_after_ms > 0 || status.error.as_deref() == Some("snapshot_required") {
            return Ok(None);
        }
        let manifest: Option<String> = self.db.query_row("SELECT manifest FROM download WHERE complete=1 AND id=(SELECT coalesce(staging,active) FROM state)", [], |r| r.get(0)).optional().map_err(io)?;
        let Some(manifest) = manifest else {
            return Ok(None);
        };
        let manifest: Manifest =
            serde_json::from_str(&manifest).map_err(|_| "storage_unavailable")?;
        let cursor: Option<String> = self
            .db
            .query_row("SELECT cursor FROM change_state", [], |r| r.get(0))
            .map_err(io)?;
        Ok(Some(match cursor {
            Some(cursor) => serde_json::json!({"cursor":cursor,"wait":wait.min(25)}),
            None => serde_json::json!({"after":manifest.revision,"epoch":manifest.epoch,"wait":0}),
        }))
    }
    pub fn change_failed(&mut self, error: &str) -> Result<(), String> {
        if error == "snapshot_required" {
            let tx = self.db.transaction().map_err(io)?;
            tx.execute("UPDATE recovery_state SET required=1", []).map_err(io)?;
            tx.execute("UPDATE state SET staging=NULL", []).map_err(io)?;
            tx.execute("UPDATE change_state SET error='snapshot_required',cursor=NULL,updating=1,next_attempt=0", []).map_err(io)?;

            return tx.commit().map_err(io);
        }
        let attempts: u32 = self
            .db
            .query_row("SELECT attempts FROM change_state", [], |r| r.get(0))
            .map_err(io)?;
        let delay = error
            .strip_prefix("retry_after:")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or((2_u64.pow(attempts.min(8)) * 2).min(300))
            .clamp(1, 86400);
        self.db.execute("UPDATE change_state SET error=?1,updating=1,attempts=min(attempts+1,9),next_attempt=?2", params![error,now()+delay as i64*1000+(uuid::Uuid::new_v4().as_u128()%1000) as i64]).map_err(io)?;
        Ok(())
    }
    pub fn apply_changes(&mut self, page: ChangePage) -> Result<(), String> {
        if self.status()?.paused { return Err("operation_cancelled".into()); }
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(io)?;
        let value: String = tx.query_row("SELECT manifest FROM download WHERE complete=1 AND id=(SELECT coalesce(staging,active) FROM state)", [], |r| r.get(0)).map_err(io)?;
        let staging: bool = tx.query_row("SELECT staging IS NOT NULL FROM state", [], |r|r.get(0)).map_err(io)?;
        let mut manifest: Manifest =
            serde_json::from_str(&value).map_err(|_| "storage_unavailable")?;
        page.validate(&manifest)?;
        let current = super::change_contract::revision(&manifest.revision)?;
        let incoming = super::change_contract::revision(&page.revision)?;
        // Already committed pages are harmless, but cannot move the checkpoint or freshness backwards.
        if incoming < current || (incoming == current && !page.changes.is_empty()) {
            return Ok(());
        }
        if super::change_contract::revision(&page.from_revision)? != current {
            return Err("invalid_response".into());
        }
        for event in &page.changes {
            // Staged metadata must not change the still-visible baseline. The
            // replacement's organization metadata is reconciled after activation.
            for removal in event.removed_memberships.iter().filter(|_| !staging) {
                tx.execute("INSERT INTO organization_membership_removal VALUES(?1,?2,?3) ON CONFLICT(prompt_id,tag_id) DO UPDATE SET revision=max(revision,excluded.revision)",params![removal.prompt_id,removal.tag_id,event.revision.parse::<i64>().map_err(|_|"invalid_response")?]).map_err(io)?;
            }
            tx.execute("DELETE FROM organization WHERE snapshot=?1", [&manifest.id])
                .map_err(io)?;
            for (kind, entries) in [
                ("collection", &event.organization.collections),
                ("tag", &event.organization.tags),
            ] {
                for entry in entries {
                    tx.execute(
                        "INSERT INTO organization VALUES(?1,?2,?3,?4,?5)",
                        params![
                            manifest.id,
                            kind,
                            entry.id,
                            entry.name,
                            serde_json::to_string(entry).map_err(|_| "invalid_response")?
                        ],
                    )
                    .map_err(io)?;
                }
            }
            if let Some(effect) = &event.effect {
                if !staging {
                tx.execute(
                    "INSERT OR REPLACE INTO organization_removed VALUES(?1,?2,?3,?4,?5,0)",
                    params![
                        effect.source_id,
                        if effect.kind == "collection.delete" {
                            "collection"
                        } else {
                            "tag"
                        },
                        effect.source_name,
                        effect.target_id,
                        event.revision
                    ],
                )
                .map_err(io)?;
                }
                apply_bulk_change(&tx, &manifest.id, event, effect, !staging)?;
            }
            for id in &event.deleted_prompt_ids {
                tx.execute(
                    "DELETE FROM prompt WHERE snapshot=?1 AND id=?2",
                    params![manifest.id, id],
                )
                .map_err(io)?;
            }
            for prompt in &event.prompts {
                if !staging {
                tx.execute("INSERT INTO organization_membership_removal SELECT ?1,t.value,?2 FROM prompt p,json_each(p.record,'$.tagIds') t WHERE p.snapshot=?3 AND p.id=?1 AND NOT EXISTS(SELECT 1 FROM json_each(?4) n WHERE n.value=t.value) ON CONFLICT(prompt_id,tag_id) DO UPDATE SET revision=excluded.revision",params![prompt.id,event.revision.parse::<i64>().map_err(|_|"invalid_response")?,manifest.id,json!(prompt.tag_ids).to_string()]).map_err(io)?;
                }
                store_baseline_prompt(&tx, &manifest.id, prompt)?;
                // Only text edits are currently exposed locally. Preserve that complete saved variant,
                // while merging independent server metadata into its visible overlay.
                let local: Option<String> = tx
                    .query_row(
                        "SELECT record FROM local_prompt WHERE id=?1",
                        [&prompt.id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(io)?;
                if let Some(local) = local.filter(|_| !staging) {
                    let saved: Prompt =
                        serde_json::from_str(&local).map_err(|_| "storage_unavailable")?;
                    let mut merged = prompt.clone();
                    merged.title = saved.title;
                    merged.description = saved.description;
                    merged.content = saved.content;
                    merged.modified_at = saved.modified_at;
                    store_overlay_prompt(&tx, &merged)?;
                }
            }
            tx.execute(
                "UPDATE download SET text_bytes=?2 WHERE id=?1",
                params![manifest.id, event.organization.text_bytes as i64],
            )
            .map_err(io)?;
        }
        manifest.revision = page.revision;
        manifest.prompt_count = tx
            .query_row(
                "SELECT count(*) FROM prompt WHERE snapshot=?1",
                [&manifest.id],
                |r| r.get(0),
            )
            .map_err(io)?;
        if manifest.prompt_count > 10000 {
            return Err("invalid_response".into());
        }
        let overlays_before: i64 = tx
            .query_row("SELECT count(*) FROM local_prompt", [], |r| r.get(0))
            .map_err(io)?;
        if !staging || !page.has_more {
            retire_downloaded_uploads(&tx, &manifest)?;
        }
        let overlays_after: i64 = tx
            .query_row("SELECT count(*) FROM local_prompt", [], |r| r.get(0))
            .map_err(io)?;
        tx.execute(
            "UPDATE download SET manifest=?2 WHERE id=?1",
            params![
                manifest.id,
                serde_json::to_string(&manifest).map_err(|_| "invalid_response")?
            ],
        )
        .map_err(io)?;
        if staging && !page.has_more {
            // A same-epoch replacement cannot roll back already applied or accepted work.
            let prior: String = tx.query_row("SELECT manifest FROM download WHERE id=(SELECT active FROM state)", [], |r|r.get(0)).map_err(io)?;
            let prior: Manifest = serde_json::from_str(&prior).map_err(|_|"storage_unavailable")?;
            if prior.epoch == manifest.epoch && super::change_contract::revision(&manifest.revision)? < super::change_contract::revision(&prior.revision)? {
                return Err("invalid_response".into());
            }
            if prior.epoch != manifest.epoch {
                tx.execute_batch("DELETE FROM organization_ack; DELETE FROM organization_membership_removal; DELETE FROM organization_removed WHERE local=0;").map_err(io)?;
            }
            tx.execute("UPDATE organization_checkpoint SET revision=NULL", []).map_err(io)?;
            reconcile_replacement_overlays(&tx, &manifest)?;
            tx.execute("UPDATE state SET active=?1,staging=NULL", [&manifest.id]).map_err(io)?;
            tx.execute("DELETE FROM download WHERE id<>?1 AND id NOT IN(SELECT snapshot FROM recovery_archive)", [&manifest.id]).map_err(io)?;
            tx.execute("UPDATE recovery_state SET required=0", []).map_err(io)?;
        }
        tx.execute(
            "UPDATE change_state SET cursor=?1,error=NULL,attempts=0,next_attempt=0,updating=?2",
            params![page.cursor, page.has_more],
        )
        .map_err(io)?;
        if !page.has_more {
            let checked = chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            tx.execute("UPDATE upload_state SET last_checked=?1", [checked])
                .map_err(io)?;
        }
        if !page.changes.is_empty() || staging || overlays_before != overlays_after {
            tx.execute("UPDATE local_state SET revision=revision+1", [])
                .map_err(io)?;
        }
        project_organization(&tx)?;
        #[cfg(test)]
        if staging && !page.has_more { test_stage("snapshot_activation")?; }
        tx.commit().map_err(io)?;
        #[cfg(test)]
        if staging && !page.has_more { test_stage("snapshot_activated")?; }
        Ok(())
    }
}
fn prompt_bytes(prompt: &Prompt) -> usize {
    prompt.title.len()
        + prompt.description.len()
        + prompt.content.len()
        + prompt.source_title.as_ref().map_or(0, String::len)
}
fn store_baseline_prompt(
    tx: &rusqlite::Transaction,
    snapshot: &str,
    prompt: &Prompt,
) -> Result<(), String> {
    for (kind, id) in prompt
        .collection_id
        .iter()
        .map(|id| ("collection", id))
        .chain(prompt.tag_ids.iter().map(|id| ("tag", id)))
    {
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM organization WHERE snapshot=?1 AND kind=?2 AND id=?3)",
                params![snapshot, kind, id],
                |r| r.get(0),
            )
            .map_err(io)?;
        if !exists {
            return Err("invalid_response".into());
        }
    }
    tx.execute("INSERT INTO prompt VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(snapshot,id) DO UPDATE SET title=excluded.title,archived=excluded.archived,record=excluded.record,text_bytes=excluded.text_bytes", params![snapshot,prompt.id,prompt.title,prompt.archived,serde_json::to_string(prompt).map_err(|_|"invalid_response")?,prompt_bytes(prompt) as i64]).map_err(io)?;
    Ok(())
}
fn store_overlay_prompt(tx: &rusqlite::Transaction, prompt: &Prompt) -> Result<(), String> {
    tx.execute(
        "UPDATE local_prompt SET title=?2,archived=?3,record=?4,text_bytes=?5 WHERE id=?1",
        params![
            prompt.id,
            prompt.title,
            prompt.archived,
            serde_json::to_string(prompt).map_err(|_| "invalid_response")?,
            prompt_bytes(prompt) as i64
        ],
    )
    .map_err(io)?;
    let revision: i64 = tx
        .query_row("SELECT revision FROM local_state", [], |r| r.get(0))
        .map_err(io)?;
    super::local_search::update(tx, prompt, revision + 1).map_err(io)?;
    Ok(())
}
fn apply_bulk_change(
    tx: &rusqlite::Transaction,
    snapshot: &str,
    event: &super::change_contract::Change,
    effect: &super::change_contract::Effect,
    merge_overlays: bool,
) -> Result<(), String> {
    // Stream one bounded prompt at a time; a compact event never builds a 100 MiB body array.
    for overlay in [false, true] {
        if overlay && !merge_overlays { continue; }
        let query = if overlay {
            "SELECT record FROM local_prompt"
        } else {
            "SELECT record FROM prompt WHERE snapshot=?1"
        };
        let mut statement = tx.prepare(query).map_err(io)?;
        let mut rows = if overlay {
            statement.query([])
        } else {
            statement.query([snapshot])
        }
        .map_err(io)?;
        while let Some(row) = rows.next().map_err(io)? {
            let mut prompt: Prompt = serde_json::from_str(&row.get::<_, String>(0).map_err(io)?)
                .map_err(|_| "storage_unavailable")?;
            let affected = if effect.kind == "collection.delete" {
                prompt.collection_id.as_ref() == Some(&effect.source_id)
            } else {
                prompt.tag_ids.contains(&effect.source_id)
            };
            if !affected {
                continue;
            }
            if effect.kind == "collection.delete" {
                prompt.collection_id = None;
            } else {
                prompt.tag_ids.retain(|id| id != &effect.source_id);
                if let Some(target) = &effect.target_id {
                    if !prompt.tag_ids.contains(target) {
                        prompt.tag_ids.push(target.clone());
                        prompt.tag_ids.sort();
                    }
                }
            }
            let prior = chrono::DateTime::parse_from_rfc3339(&prompt.modified_at)
                .map_err(|_| "storage_unavailable")?;
            let accepted = chrono::DateTime::parse_from_rfc3339(&event.accepted_at)
                .map_err(|_| "invalid_response")?;
            prompt.modified_at = accepted
                .max(prior + chrono::Duration::milliseconds(1))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            prompt.revision = event.revision.clone();
            if overlay {
                store_overlay_prompt(tx, &prompt)?;
            } else {
                store_baseline_prompt(tx, snapshot, &prompt)?;
            }
        }
    }
    Ok(())
}
