// Included in library_storage: all local writes use its one native-owned connection.
#[derive(serde::Serialize, serde::Deserialize)]
struct SaveReceipt {
    local_revision: String,
    projection_hash: String,
}
fn projection_hash(prompt: &Prompt) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(prompt).map_err(|_| "storage_unavailable")?)
    ))
}
fn record_receipt(
    tx: &rusqlite::Transaction,
    operation_id: &str,
    fingerprint: &str,
    result: &super::local_contract::LocalPrompt,
) -> Result<(), String> {
    let receipt = SaveReceipt {
        local_revision: result.local_revision.clone(),
        projection_hash: projection_hash(&result.prompt)?,
    };
    tx.execute(
        "INSERT INTO local_receipt VALUES(?1,?2,?3)",
        params![
            operation_id,
            fingerprint,
            serde_json::to_string(&receipt).map_err(|_| "storage_unavailable")?
        ],
    )
    .map_err(io)?;
    Ok(())
}
#[cfg(test)]
thread_local! { static TEST_FAULT: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) }; }
#[cfg(test)]
pub fn set_test_fault(fault: &str) {
    TEST_FAULT.with(|value| *value.borrow_mut() = fault.into());
}
#[cfg(test)]
fn test_stage(stage: &str) -> Result<(), String> {
    use std::io::Write;
    if std::env::var("PR0_LOCAL_TEST_PAUSE").as_deref() == Ok(stage) {
        println!("PAUSED:{stage}");
        std::io::stdout().flush().unwrap();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }
    if TEST_FAULT.with(|value| value.borrow().as_str() == "after_commit_error")
        && stage == "after_commit"
    {
        return Err("commit_uncertain".into());
    }
    Ok(())
}
impl LibraryStore {
    pub fn known_usage(&self) -> Result<(i64, i64), String> {
        known_usage(&self.db)
    }
    pub fn pending_count(&self) -> Result<u32, String> {
        self.db
            .query_row("SELECT (SELECT count(*) FROM outbox)+(SELECT count(*) FROM pending_usage)", [], |r| r.get(0))
            .map_err(io)
    }
    pub fn local_detail(&self, id: &str) -> Result<super::local_contract::LocalPrompt, String> {
        let revision: i64 = self
            .db
            .query_row("SELECT revision FROM local_state", [], |r| r.get(0))
            .map_err(io)?;
        let pending = self
            .db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM outbox WHERE prompt_id=?1 AND state<>'accepted_awaiting_download')",
                [id],
                |r| r.get(0),
            )
            .map_err(io)?;
        Ok(super::local_contract::LocalPrompt {
            prompt: self.detail(id)?,
            local_revision: revision.to_string(),
            pending,
        })
    }
    #[cfg(test)]
    pub fn pending_changes(&self) -> Result<Vec<super::local_contract::PendingChange>, String> {
        // Bounded diagnostic read for native callers; transport owns delivery transitions.
        let mut statement = self
            .db
            .prepare(
                "SELECT payload,state,local_revision FROM outbox ORDER BY local_revision LIMIT 100",
            )
            .map_err(io)?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        rows.into_iter()
            .map(|(payload, state, revision)| {
                Ok(super::local_contract::PendingChange {
                    payload: serde_json::from_str(&payload).map_err(|_| "storage_unavailable")?,
                    state,
                    local_revision: revision.to_string(),
                })
            })
            .collect()
    }
    pub fn save(
        &mut self,
        request: super::local_contract::SaveRequest,
        create: bool,
    ) -> Result<super::local_contract::LocalPrompt, String> {
        use super::local_contract::{uuid4, LocalPrompt, PromptText};
        if !uuid4(&request.operation_id)
            || !uuid4(&request.prompt_id)
            || create != request.expected_local_revision.is_none()
        {
            return Err("invalid_input".into());
        }
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(
                    create,
                    &request.instance_id,
                    &request.account_id,
                    &request.prompt_id,
                    &request.expected_local_revision,
                    &request.desired
                ))
                .map_err(|_| "invalid_input")?
            )
        );
        let desired = request.desired.validate()?;
        #[cfg(test)]
        TEST_FAULT.with(|fault| -> Result<(), String> {
            match fault.borrow().as_str() {
                "disk_full" => {
                    let pages: i64 = self
                        .db
                        .query_row("PRAGMA page_count", [], |r| r.get(0))
                        .map_err(io)?;
                    self.db
                        .pragma_update(None, "max_page_count", pages)
                        .map_err(io)?;
                }
                "io_error" => self.db.execute_batch("PRAGMA query_only=ON").map_err(io)?,
                _ => {}
            };
            Ok(())
        })?;
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(io)?;
        let receipt: Option<(String, String)> = tx
            .query_row(
                "SELECT fingerprint,result FROM local_receipt WHERE id=?1",
                [&request.operation_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(io)?;
        if let Some((hash, result)) = receipt {
            if hash != fingerprint {
                return Err("operation_identity_reused".into());
            }
            let receipt: SaveReceipt =
                serde_json::from_str(&result).map_err(|_| "storage_unavailable")?;
            let record: String = tx
                .query_row(
                    "SELECT record FROM visible_prompt WHERE id=?1",
                    [&request.prompt_id],
                    |r| r.get(0),
                )
                .map_err(io)?;
            let prompt: Prompt =
                serde_json::from_str(&record).map_err(|_| "storage_unavailable")?;
            if projection_hash(&prompt)? != receipt.projection_hash {
                return Err("save_superseded".into());
            }
            let pending = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM outbox WHERE prompt_id=?1 AND state<>'accepted_awaiting_download')",
                    [&request.prompt_id],
                    |r| r.get(0),
                )
                .map_err(io)?;
            return Ok(LocalPrompt {
                prompt,
                local_revision: receipt.local_revision,
                pending,
            });
        }
        let previous: Option<String> = tx
            .query_row(
                "SELECT record FROM visible_prompt WHERE id=?1",
                [&request.prompt_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(io)?;
        let previous: Option<Prompt> = previous
            .map(|record| serde_json::from_str(&record).map_err(|_| "storage_unavailable"))
            .transpose()?;
        let current_revision: i64 = tx
            .query_row("SELECT revision FROM local_state", [], |r| r.get(0))
            .map_err(io)?;
        if create == previous.is_some()
            || (!create
                && request.expected_local_revision.as_deref()
                    != Some(current_revision.to_string().as_str()))
        {
            return Err("local_revision_conflict".into());
        }
        let latest: Option<(String,String,String)> = tx.query_row("SELECT id,payload,state FROM outbox WHERE prompt_id=?1 ORDER BY local_revision DESC LIMIT 1",[&request.prompt_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(io)?;
        if let Some(old) = &previous {
            if PromptText::from_prompt(old) == desired {
                let result = LocalPrompt {
                    prompt: old.clone(),
                    local_revision: current_revision.to_string(),
                    pending: latest.as_ref().is_some_and(|(_,_,state)|state!="accepted_awaiting_download"),
                };
                record_receipt(&tx, &request.operation_id, &fingerprint, &result)?;
                #[cfg(test)]
                test_stage("before_commit")?;
                commit_search(tx)?;
                #[cfg(test)]
                test_stage("after_commit")?;
                return Ok(result);
            }
        }
        let (count, used) = known_usage(&tx)?;
        let old_bytes = previous.as_ref().map_or(0, |p| {
            p.title.len()
                + p.description.len()
                + p.content.len()
                + p.source_title.as_ref().map_or(0, String::len)
        }) as i64;
        let bytes = (desired.title.len()
            + desired.description.len()
            + desired.content.len()
            + previous
                .as_ref()
                .and_then(|p| p.source_title.as_ref())
                .map_or(0, String::len)) as i64;
        if (create && count >= 10_000)
            || (bytes > old_bytes && used + bytes - old_bytes > 104_857_600)
        {
            return Err("quota_exceeded".into());
        }
        let now = chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let mut prompt = previous.clone().unwrap_or_else(|| Prompt {
            instance_id: self.instance.clone(),
            account_id: self.account.clone(),
            id: request.prompt_id.clone(),
            title: String::new(),
            description: String::new(),
            content: String::new(),
            revision: "0".into(),
            created_at: now.clone(),
            modified_at: now.clone(),
            favorite: false,
            archived: false,
            collection_id: None,
            tag_ids: vec![],
            use_count: 0,
            last_used_at: None,
            source_title: None,
        });
        prompt.title = desired.title.clone();
        prompt.description = desired.description.clone();
        prompt.content = desired.content.clone();
        prompt.modified_at = now;
        let revision: i64 = tx
            .query_row(
                "UPDATE local_state SET revision=revision+1 RETURNING revision",
                [],
                |r| r.get(0),
            )
            .map_err(io)?;
        let record = serde_json::to_string(&prompt).map_err(|_| "invalid_input")?;
        tx.execute("INSERT INTO local_prompt VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET title=excluded.title,archived=excluded.archived,record=excluded.record,text_bytes=excluded.text_bytes",params![prompt.id,prompt.title,prompt.archived,record,bytes]).map_err(io)?;
        #[cfg(test)]
        test_stage("after_projection")?;
        let mut operation = super::local_contract::PendingOperation::new(
            request.operation_id.clone(),
            prompt.id.clone(),
            previous.as_ref(),
            desired.clone(),
        );
        if let Some((id, payload, state)) = latest {
            if state == "unsent" {
                operation = serde_json::from_str(&payload).map_err(|_| "storage_unavailable")?;
                operation.operation_id = request.operation_id.clone();
                tx.execute("DELETE FROM outbox WHERE id=?1", [id])
                    .map_err(io)?;
            } else {
                operation.depends_on = vec![id];
            }
        }
        operation.update_desired(desired);
        tx.execute("INSERT INTO outbox(id,prompt_id,payload,state,local_revision) VALUES(?1,?2,?3,'unsent',?4)",params![request.operation_id,prompt.id,serde_json::to_string(&operation).map_err(|_|"storage_unavailable")?,revision]).map_err(io)?;
        let result = LocalPrompt {
            prompt,
            local_revision: revision.to_string(),
            pending: true,
        };
        record_receipt(&tx, &request.operation_id, &fingerprint, &result)?;
        #[cfg(test)]
        test_stage("before_commit")?;
        commit_search(tx)?;
        #[cfg(test)]
        test_stage("after_commit")?;
        Ok(result)
    }
}

fn known_usage(db: &Connection) -> Result<(i64, i64), String> {
    // The manifest and first-page quota cover records not downloaded yet.
    let (baseline_count,baseline_bytes):(i64,i64)=db.query_row("SELECT coalesce((SELECT json_extract(manifest,'$.promptCount') FROM download WHERE id=(SELECT active FROM state)),0),max(coalesce((SELECT text_bytes FROM download WHERE id=(SELECT active FROM state)),0),coalesce((SELECT sum(text_bytes) FROM prompt WHERE snapshot=(SELECT active FROM state)),0)+coalesce((SELECT sum(length(cast(name AS BLOB))) FROM organization WHERE snapshot=(SELECT active FROM state)),0))",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(io)?;
    let (extra_count,extra_bytes):(i64,i64)=db.query_row("SELECT coalesce(sum(CASE WHEN p.id IS NULL THEN 1 ELSE 0 END),0),coalesce(sum(l.text_bytes-coalesce(p.text_bytes,0)),0) FROM local_prompt l LEFT JOIN prompt p ON p.id=l.id AND p.snapshot=(SELECT active FROM state)",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(io)?;
    Ok((baseline_count + extra_count, baseline_bytes + extra_bytes))
}
