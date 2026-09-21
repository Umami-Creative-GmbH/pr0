// Included in library_storage. Receipts and successor transitions commit together.
use super::local_contract::{PendingAction, PendingOperation};
use super::upload_contract::{now, Mapping, Outcome, PendingError, UploadStatus};
impl LibraryStore {
    pub fn required_download_revision(&self) -> Result<String, String> {
        let revision:i64=self.db.query_row("SELECT coalesce(max(cast(json_extract(receipt,'$.revision') AS INTEGER)),0) FROM (SELECT receipt FROM outbox WHERE state='accepted_awaiting_download' UNION ALL SELECT receipt FROM pending_usage WHERE receipt IS NOT NULL)",[],|r|r.get(0)).map_err(io)?;
        Ok(revision.to_string())
    }
    pub fn upload_ready(&self) -> Result<bool, String> {
        self.db.query_row("SELECT EXISTS(SELECT 1 FROM outbox o WHERE state<>'accepted_awaiting_download' AND next_attempt<=?1 AND NOT EXISTS(SELECT 1 FROM json_each(o.payload,'$.dependsOn') d JOIN outbox p ON p.id=d.value WHERE p.state<>'accepted_awaiting_download'))",[now()],|r|r.get(0)).map_err(io)
    }
    pub fn refresh_required(&self) -> Result<bool, String> {
        self.db
            .query_row("SELECT refresh OR EXISTS(SELECT 1 FROM pending_usage WHERE receipt IS NOT NULL) OR last_checked IS NULL OR (julianday('now')-julianday(last_checked))*86400>=30 FROM upload_state", [], |r| r.get(0))
            .map_err(io)
    }
    pub fn confirm_unchanged_snapshot(&self, manifest: &Manifest) -> Result<bool, String> {
        let unchanged:bool=self.db.query_row("SELECT EXISTS(SELECT 1 FROM download WHERE id=(SELECT active FROM state) AND complete=1 AND json_extract(manifest,'$.revision')=?1 AND json_extract(manifest,'$.epoch')=?2) AND NOT EXISTS(SELECT 1 FROM pending_usage WHERE receipt IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM outbox WHERE state='accepted_awaiting_download')",params![manifest.revision,manifest.epoch],|r|r.get(0)).map_err(io)?;
        if unchanged {
            let checked = chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            self.db
                .execute(
                    "UPDATE upload_state SET last_checked=?1,refresh=0",
                    [checked],
                )
                .map_err(io)?;
        }
        Ok(unchanged)
    }
    pub fn upload_status(&self) -> Result<UploadStatus, String> {
        let (error, next): (Option<String>, i64) = self
            .db
            .query_row("SELECT error,next_attempt FROM upload_state", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .map_err(io)?;
        let waiting = self
            .db
            .query_row(
                "SELECT count(*) FROM outbox WHERE state<>'accepted_awaiting_download'",
                [],
                |r| r.get(0),
            )
            .map_err(io)?;
        let awaiting_download = self
            .db
            .query_row(
                "SELECT count(*) FROM outbox WHERE state='accepted_awaiting_download'",
                [],
                |r| r.get(0),
            )
            .map_err(io)?;
        let mut statement = self.db.prepare("SELECT prompt_id,coalesce(error,'dependency_blocked') FROM outbox o WHERE error IS NOT NULL OR EXISTS(SELECT 1 FROM json_each(o.payload,'$.dependsOn') d JOIN outbox p ON p.id=d.value WHERE p.error IS NOT NULL) ORDER BY local_revision LIMIT 100").map_err(io)?;
        let errors = statement
            .query_map([], |r| {
                Ok(PendingError {
                    prompt_id: r.get(0)?,
                    code: r.get(1)?,
                })
            })
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        let mut statement = self
            .db
            .prepare("SELECT original,copy FROM prompt_mapping ORDER BY rowid DESC LIMIT 100")
            .map_err(io)?;
        let mappings = statement
            .query_map([], |r| {
                Ok(Mapping {
                    original_id: r.get(0)?,
                    copy_id: r.get(1)?,
                })
            })
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        let last_checked_at = self
            .db
            .query_row("SELECT last_checked FROM upload_state", [], |r| r.get(0))
            .map_err(io)?;
        let mut statement=self.db.prepare("SELECT l.id,l.title,EXISTS(SELECT 1 FROM local_deleted d WHERE d.id=l.id) FROM local_prompt l WHERE EXISTS(SELECT 1 FROM outbox o WHERE o.prompt_id=l.id AND o.state<>'accepted_awaiting_download') ORDER BY l.id LIMIT 10000").map_err(io)?;
        let pending=statement.query_map([],|r|Ok(super::upload_contract::PendingPrompt{prompt_id:r.get(0)?,title:r.get(1)?,deleting:r.get(2)?})).map_err(io)?.collect::<Result<Vec<_>,_>>().map_err(io)?;
        Ok(UploadStatus {
            waiting,
            awaiting_download,
            error,
            retry_after_ms: next.saturating_sub(now()).max(0) as u64,
            errors,
            mappings,
            last_checked_at,
            pending,
        })
    }
    pub fn upload_failed(&mut self, error: &str) -> Result<(), String> {
        let attempts: u32 = self
            .db
            .query_row("SELECT attempts FROM upload_state", [], |r| r.get(0))
            .map_err(io)?;
        let delay = error
            .strip_prefix("retry_after:")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or((2_u64.pow(attempts.min(8)) * 2).min(300))
            .clamp(1, 86400);
        self.db
            .execute(
                "UPDATE upload_state SET attempts=min(attempts+1,9),next_attempt=?1,error=?2",
                params![
                    now() + delay as i64 * 1000 + (uuid::Uuid::new_v4().as_u128() % 1000) as i64,
                    error
                ],
            )
            .map_err(io)?;
        Ok(())
    }
    pub fn upload_succeeded(&mut self) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE upload_state SET attempts=0,next_attempt=0,error=NULL",
                [],
            )
            .map_err(io)?;
        Ok(())
    }
    pub fn prepare_upload(&mut self) -> Result<Option<(serde_json::Value, bool)>, String> {
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(io)?;
        let manifest: Option<String> = tx
            .query_row(
                "SELECT manifest FROM download WHERE complete=1 AND id=(SELECT active FROM state)",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(io)?;
        let Some(manifest) = manifest else {
            return Ok(None);
        };
        let manifest: Manifest =
            serde_json::from_str(&manifest).map_err(|_| "storage_unavailable")?;
        let row: Option<(String,String,Option<String>)> = tx.query_row("SELECT o.id,o.payload,o.envelope FROM outbox o WHERE o.state<>'accepted_awaiting_download' AND o.next_attempt<=?1 AND NOT EXISTS(SELECT 1 FROM json_each(o.payload,'$.dependsOn') d JOIN outbox parent ON parent.id=d.value WHERE parent.state<>'accepted_awaiting_download') ORDER BY o.local_revision LIMIT 1",[now()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(io)?;
        let Some((id, payload, frozen)) = row else {
            return Ok(None);
        };
        let replay = frozen.is_some();
        let body = match frozen {
            Some(value) => value,
            None => {
                let installation: String = tx
                    .query_row("SELECT installation FROM local_state", [], |r| r.get(0))
                    .map_err(io)?;
                let operation: PendingOperation =
                    serde_json::from_str(&payload).map_err(|_| "storage_unavailable")?;
                let operation = operation.wire()?;
                serde_json::json!({"protocolVersion":1,"instanceId":self.instance,"accountId":self.account,"epoch":manifest.epoch,"installationId":installation,"operations":[operation]}).to_string()
            }
        };
        if body.len() > 4_194_304 {
            return Err("invalid_input".into());
        }
        tx.execute(
            "UPDATE outbox SET state='in_flight',envelope=?2,error=NULL WHERE id=?1",
            params![id, body],
        )
        .map_err(io)?;
        tx.commit().map_err(io)?;
        #[cfg(test)]
        test_stage("upload_frozen")?;
        Ok(Some((
            serde_json::from_str(&body).map_err(|_| "storage_unavailable")?,
            replay,
        )))
    }
    pub fn acknowledge_upload(
        &mut self,
        body: &serde_json::Value,
        outcome: Outcome,
    ) -> Result<(), String> {
        let id = body["operations"][0]["operationId"].as_str().ok_or("invalid_response")?;
        let payload: Option<String> = self.db.query_row("SELECT payload FROM outbox WHERE id=?1 AND envelope=?2",params![id,body.to_string()],|r|r.get(0)).optional().map_err(io)?;
        let Some(payload) = payload else { return Ok(()); };
        let sent: PendingOperation = serde_json::from_str(&payload).map_err(|_| "storage_unavailable")?;
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(io)?;
        let state: Option<String> = tx
            .query_row(
                "SELECT state FROM outbox WHERE id=?1",
                [&sent.operation_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(io)?;
        if state.as_deref() != Some("in_flight") {
            return Ok(());
        }
        match outcome {
            Outcome::Rejected { error } => {
                if error.operation_id != sent.operation_id || error.code.len() > 100 {
                    return Err("invalid_response".into());
                }
                let retry = if error.retryable {
                    now()
                        + error.retry_after.unwrap_or(60).clamp(1, 86400) as i64 * 1000
                        + (uuid::Uuid::new_v4().as_u128() % 1000) as i64
                } else {
                    i64::MAX
                };
                tx.execute(
                    "UPDATE outbox SET error=?2,next_attempt=?3 WHERE id=?1",
                    params![sent.operation_id, error.code, retry],
                )
                .map_err(io)?;
            }
            Outcome::Accepted(receipt) => {
                if receipt.operation_id != sent.operation_id
                    || receipt.prompt_id != sent.prompt_id
                    || !super::auth_contract::valid_id(&receipt.prompt_id)
                    || receipt
                        .revision
                        .parse::<i64>()
                        .ok()
                        .filter(|r| *r >= 0 && r.to_string() == receipt.revision)
                        .is_none()
                    || chrono::DateTime::parse_from_rfc3339(&receipt.accepted_at).is_err()
                    || receipt.conflict.as_ref().is_some_and(|c| {
                        !super::local_contract::uuid4(&c.copy_id)
                            || !super::local_contract::uuid4(&c.notice_id)
                            || c.copy_id == sent.prompt_id
                    })
                {
                    return Err("invalid_response".into());
                }
                if matches!(sent.action, PendingAction::Delete) {
                    tx.execute("UPDATE outbox SET state='accepted_awaiting_download',receipt=?2,error=NULL WHERE id=?1",params![sent.operation_id,serde_json::to_string(&receipt).map_err(|_|"storage_unavailable")?]).map_err(io)?;
                    tx.execute("UPDATE upload_state SET refresh=1",[]).map_err(io)?;
                    let active:Option<String>=tx.query_row("SELECT manifest FROM download WHERE complete=1 AND id=(SELECT active FROM state)",[],|r|r.get(0)).optional().map_err(io)?;
                    if let Some(active) = active {
                        retire_downloaded_uploads(&tx,&serde_json::from_str(&active).map_err(|_|"storage_unavailable")?)?;
                    }
                    return tx.commit().map_err(io);
                }
                let target = receipt
                    .conflict
                    .as_ref()
                    .map_or(sent.prompt_id.as_str(), |c| c.copy_id.as_str());
                let revision: i64 = tx
                    .query_row(
                        "UPDATE local_state SET revision=revision+1 RETURNING revision",
                        [],
                        |r| r.get(0),
                    )
                    .map_err(io)?;
                let mut baseline = sent.desired.clone();
                if matches!(sent.action,PendingAction::Duplicate{..}) {
                    baseline.title=format!("{} (copy)",baseline.title.chars().take(193).collect::<String>());
                }
                if receipt.conflict.is_some() {
                    baseline.title = format!(
                        "{} (conflict copy)",
                        baseline.title.chars().take(184).collect::<String>()
                    );
                }
                let (has_successor,metadata) = rebase_successors(&tx,&sent,&receipt,target,&baseline)?;
                let record: String = tx
                    .query_row(
                        "SELECT record FROM local_prompt WHERE id=?1",
                        [&sent.prompt_id],
                        |r| r.get(0),
                    )
                    .map_err(io)?;
                let mut prompt: Prompt =
                    serde_json::from_str(&record).map_err(|_| "storage_unavailable")?;
                if prompt.title == sent.desired.title {
                    prompt.title = baseline.title;
                }
                prompt.id = target.into();
                if matches!(sent.action,PendingAction::Create|PendingAction::Duplicate{..}) || receipt.conflict.is_some() {
                    prompt.revision = receipt.revision.clone();
                }
                if !has_successor {
                    prompt.modified_at = receipt.accepted_at.clone();
                }
                if matches!(sent.action, PendingAction::Create | PendingAction::Duplicate { .. }) || receipt.conflict.is_some() {
                    prompt.created_at = receipt.accepted_at.clone();
                }
                if receipt.conflict.is_some() {
                    prompt.favorite = false;
                    prompt.archived = false;
                    prompt.use_count = 0;
                    prompt.last_used_at = None;
                    prompt.source_title = Some(sent.desired.title.clone());
                    prompt.tag_ids.clear();
                    for value in &metadata { value.apply(&mut prompt); }
                    tx.execute("UPDATE local_deleted SET id=?2 WHERE id=?1",params![sent.prompt_id,target]).map_err(io)?;
                    tx.execute("INSERT OR IGNORE INTO local_identity VALUES(?1)",[target]).map_err(io)?;
                    tx.execute(
                        "INSERT OR REPLACE INTO prompt_mapping VALUES(?1,?2,?3)",
                        params![sent.prompt_id, target, sent.operation_id],
                    )
                    .map_err(io)?;
                    super::local_search::remove(&tx, &sent.prompt_id).map_err(io)?;
                    tx.execute("DELETE FROM local_prompt WHERE id=?1", [&sent.prompt_id])
                        .map_err(io)?;
                }
                let bytes = prompt.title.len()
                    + prompt.description.len()
                    + prompt.content.len()
                    + prompt.source_title.as_ref().map_or(0, String::len);
                tx.execute(
                    "INSERT OR REPLACE INTO local_prompt VALUES(?1,?2,?3,?4,?5)",
                    params![
                        target,
                        prompt.title,
                        prompt.archived,
                        serde_json::to_string(&prompt).map_err(|_| "storage_unavailable")?,
                        bytes as i64
                    ],
                )
                .map_err(io)?;
                let deleted:bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM local_deleted WHERE id=?1)",[target],|r|r.get(0)).map_err(io)?;
                if !deleted { super::local_search::update(&tx, &prompt, revision).map_err(io)?; }
                tx.execute("UPDATE outbox SET state='accepted_awaiting_download',prompt_id=?2,receipt=?3,error=NULL WHERE id=?1",params![sent.operation_id,target,serde_json::to_string(&receipt).map_err(|_|"storage_unavailable")?]).map_err(io)?;
                tx.execute("UPDATE upload_state SET refresh=1", [])
                    .map_err(io)?;
                let active:Option<String>=tx.query_row("SELECT manifest FROM download WHERE complete=1 AND id=(SELECT active FROM state)",[],|r|r.get(0)).optional().map_err(io)?;
                if let Some(active) = active {
                    let active: Manifest =
                        serde_json::from_str(&active).map_err(|_| "storage_unavailable")?;
                    retire_downloaded_uploads(&tx, &active)?;
                }
            }
            Outcome::Unknown { .. } => return Err("invalid_response".into()),
        }
        #[cfg(test)]
        test_stage("upload_acknowledgement")?;
        tx.commit().map_err(io)
    }
}
// Retarget all successors; only the direct dependency gets an acknowledged base.
fn rebase_successors(
    tx: &rusqlite::Transaction,
    sent: &PendingOperation,
    receipt: &super::upload_contract::Receipt,
    target: &str,
    baseline: &super::local_contract::PromptText,
) -> Result<(bool,Vec<super::lifecycle_contract::PendingMetadata>),String> {
    let mut statement = tx.prepare("SELECT id,payload FROM outbox WHERE prompt_id=?1 AND state='unsent' ORDER BY local_revision").map_err(io)?;
    let rows=statement.query_map([&sent.prompt_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(io)?.collect::<Result<Vec<_>,_>>().map_err(io)?;
    let has_successor=!rows.is_empty();
    let mut metadata=Vec::new();
    for (id,payload) in rows {
        let mut operation:PendingOperation=serde_json::from_str(&payload).map_err(|_|"storage_unavailable")?;
        let direct=operation.depends_on.contains(&sent.operation_id);
        if receipt.conflict.is_some() || direct {
            operation.prompt_id=target.into();
            if operation.desired.title==sent.desired.title { operation.desired.title=baseline.title.clone(); }
            if direct {
                let deleting=matches!(operation.action,PendingAction::Delete);
                // Metadata receipts do not prove that unseen text was observed.
                if !deleting || matches!(sent.action,PendingAction::Create|PendingAction::Duplicate{..}) || receipt.conflict.is_some() {
                    operation.base_revision=receipt.revision.clone();
                }
                operation.depends_on.retain(|dependency|dependency!=&sent.operation_id);
                if !deleting {
                    operation.action=PendingAction::Update{base:baseline.clone(),changed_fields:vec![]};
                    operation.update_desired(operation.desired.clone());
                }
            }
            tx.execute("UPDATE outbox SET prompt_id=?2,payload=?3 WHERE id=?1",params![id,target,serde_json::to_string(&operation).map_err(|_|"storage_unavailable")?]).map_err(io)?;
        }
        if let Some(value)=operation.metadata { metadata.push(value); }
    }
    Ok((has_successor,metadata))
}
fn retire_downloaded_uploads(
    tx: &rusqlite::Transaction,
    manifest: &Manifest,
) -> Result<(), String> {
    tx.execute("DELETE FROM pending_usage WHERE receipt IS NOT NULL AND cast(json_extract(receipt,'$.revision') AS INTEGER)<=?1 AND json_extract(envelope,'$.epoch')=?2",params![manifest.revision.parse::<i64>().map_err(|_|"invalid_response")?,manifest.epoch]).map_err(io)?;
    tx.execute("DELETE FROM outbox WHERE state='accepted_awaiting_download' AND cast(json_extract(receipt,'$.revision') AS INTEGER)<=?1 AND json_extract(envelope,'$.epoch')=?2",params![manifest.revision.parse::<i64>().map_err(|_|"invalid_response")?,manifest.epoch]).map_err(io)?;
    let ids = {
        let mut statement = tx
            .prepare("SELECT id FROM local_prompt WHERE id NOT IN(SELECT prompt_id FROM outbox)")
            .map_err(io)?;
        let ids = statement
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        ids
    };
    for id in ids {
        super::local_search::remove(tx, &id).map_err(io)?;
        tx.execute("DELETE FROM local_prompt WHERE id=?1", [id])
            .map_err(io)?;
    }
    tx.execute("DELETE FROM local_deleted WHERE id NOT IN(SELECT prompt_id FROM outbox)",[]).map_err(io)?;
    tx.execute("UPDATE upload_state SET refresh=EXISTS(SELECT 1 FROM outbox WHERE state='accepted_awaiting_download')",[]).map_err(io)?;
    Ok(())
}
