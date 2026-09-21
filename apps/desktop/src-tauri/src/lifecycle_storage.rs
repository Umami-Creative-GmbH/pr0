// Included in library_storage: projection and outbox share one transaction.
fn duplicate_title(title: &str) -> String {
    format!("{} (copy)", title.chars().take(193).collect::<String>())
}

impl LibraryStore {
    pub fn lifecycle(
        &mut self,
        request: super::lifecycle_contract::LifecycleRequest,
    ) -> Result<super::lifecycle_contract::LifecycleResult, String> {
        use super::lifecycle_contract::{LifecycleAction, LifecycleResult, PendingMetadata};
        use super::local_contract::{uuid4, PendingOperation, PromptText};
        if !uuid4(&request.operation_id) || !uuid4(&request.prompt_id) {
            return Err("invalid_input".into());
        }
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(
                    &request.instance_id,
                    &request.account_id,
                    &request.prompt_id,
                    &request.expected_local_revision,
                    &request.action
                ))
                .map_err(|_| "invalid_input")?
            )
        );
        #[cfg(test)]
        apply_test_fault(&self.db)?;
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
            return serde_json::from_str(&result).map_err(|_| "storage_unavailable".into());
        }
        let revision: i64 = tx
            .query_row("SELECT revision FROM local_state", [], |r| r.get(0))
            .map_err(io)?;
        if request.expected_local_revision != revision.to_string() {
            return Err("local_revision_conflict".into());
        }
        let record: Option<String> = tx
            .query_row(
                "SELECT record FROM visible_prompt WHERE id=?1",
                [&request.prompt_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(io)?;
        let mut prompt: Prompt = serde_json::from_str(&record.ok_or("prompt_unavailable")?)
            .map_err(|_| "storage_unavailable")?;
        let mut operation = PendingOperation::new(
            request.operation_id.clone(),
            prompt.id.clone(),
            Some(&prompt),
            PromptText::from_prompt(&prompt),
        );
        let deleting = matches!(request.action, LifecycleAction::Delete { .. });
        let changed = match request.action {
            LifecycleAction::Delete { confirmed } => {
                if !confirmed {
                    return Err("confirmation_required".into());
                }
                operation.action = super::local_contract::PendingAction::Delete;
                true
            }
            LifecycleAction::Favorite { value } => {
                operation.metadata = Some(PendingMetadata::Favorite {
                    base: prompt.favorite,
                    desired: value,
                });
                let changed = prompt.favorite != value;
                prompt.favorite = value;
                changed
            }
            LifecycleAction::Archive { value } => {
                operation.metadata = Some(PendingMetadata::Archived {
                    base: prompt.archived,
                    desired: value,
                });
                let changed = prompt.archived != value;
                prompt.archived = value;
                changed
            }
            LifecycleAction::Duplicate { copy_id } => {
                if !uuid4(&copy_id) || copy_id == prompt.id {
                    return Err("invalid_input".into());
                }
                let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM visible_prompt WHERE id=?1) OR EXISTS(SELECT 1 FROM local_identity WHERE id=?1)",[&copy_id],|r|r.get(0)).map_err(io)?;
                if exists {
                    return Err("operation_identity_reused".into());
                }
                let (count, used) = known_usage(&tx)?;
                prompt.source_title = Some(prompt.title.clone());
                prompt.title = duplicate_title(&prompt.title);
                if count >= 10_000
                    || used
                        + (prompt.title.len()
                            + prompt.description.len()
                            + prompt.content.len()
                            + prompt.source_title.as_ref().map_or(0, String::len))
                            as i64
                        > 104_857_600
                {
                    return Err("quota_exceeded".into());
                }
                operation.action = super::local_contract::PendingAction::Duplicate {
                    source_id: prompt.id.clone(),
                    collection_id: prompt.collection_id.clone(),
                    tag_ids: prompt.tag_ids.clone(),
                };
                prompt.id = copy_id;
                prompt.favorite = false;
                prompt.archived = false;
                prompt.use_count = 0;
                prompt.last_used_at = None;
                prompt.revision = "0".into();
                prompt.created_at =
                    chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                operation.prompt_id = prompt.id.clone();
                operation.base_revision = "0".into();
                true
            }
        };
        let mut revision = revision;
        if changed {
            let latest: Option<String> = tx.query_row("SELECT id FROM outbox WHERE prompt_id=?1 AND state<>'accepted_awaiting_download' ORDER BY local_revision DESC LIMIT 1",[&prompt.id],|r|r.get(0)).optional().map_err(io)?;
            operation.depends_on = latest.into_iter().collect();
            if let super::local_contract::PendingAction::Duplicate { source_id, .. } =
                &operation.action
            {
                let parent:Option<String>=tx.query_row("SELECT id FROM outbox WHERE prompt_id=?1 AND state<>'accepted_awaiting_download' AND json_extract(payload,'$.kind') IN ('prompt.create','prompt.duplicate') ORDER BY local_revision LIMIT 1",[source_id],|r|r.get(0)).optional().map_err(io)?;
                operation.depends_on = parent.into_iter().collect();
            }
            revision = tx
                .query_row(
                    "UPDATE local_state SET revision=revision+1 RETURNING revision",
                    [],
                    |r| r.get(0),
                )
                .map_err(io)?;
            prompt.modified_at =
                chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            let bytes = prompt.title.len()
                + prompt.description.len()
                + prompt.content.len()
                + prompt.source_title.as_ref().map_or(0, String::len);
            tx.execute(
                "INSERT OR REPLACE INTO local_prompt VALUES(?1,?2,?3,?4,?5)",
                params![
                    prompt.id,
                    prompt.title,
                    prompt.archived,
                    serde_json::to_string(&prompt).map_err(|_| "storage_unavailable")?,
                    bytes as i64
                ],
            )
            .map_err(io)?;
            tx.execute(
                "INSERT OR IGNORE INTO local_identity VALUES(?1)",
                [&prompt.id],
            )
            .map_err(io)?;
            if deleting {
                tx.execute("INSERT INTO local_deleted VALUES(?1)", [&prompt.id])
                    .map_err(io)?;
            }
            tx.execute("INSERT INTO outbox(id,prompt_id,payload,state,local_revision) VALUES(?1,?2,?3,'unsent',?4)",params![request.operation_id,prompt.id,serde_json::to_string(&operation).map_err(|_|"storage_unavailable")?,revision]).map_err(io)?;
            // Actions against the pre-restore library need the same explicit review as text edits.
            // A duplicate also inherits its source's recovery restriction.
            tx.execute("INSERT OR IGNORE INTO recovery_blocked SELECT ?1 WHERE EXISTS(SELECT 1 FROM recovery_archive WHERE snapshot=(SELECT active FROM state)) OR EXISTS(SELECT 1 FROM recovery_blocked WHERE prompt_id=?2)",params![prompt.id,request.prompt_id]).map_err(io)?;
            tx.execute("UPDATE outbox SET error='recovery_required',next_attempt=9223372036854775807 WHERE id=?1 AND prompt_id IN(SELECT prompt_id FROM recovery_blocked)",[&request.operation_id]).map_err(io)?;
        }
        let result = LifecycleResult {
            prompt_id: prompt.id,
            local_revision: revision.to_string(),
        };
        tx.execute(
            "INSERT INTO local_receipt VALUES(?1,?2,?3)",
            params![
                request.operation_id,
                fingerprint,
                serde_json::to_string(&result).map_err(|_| "storage_unavailable")?
            ],
        )
        .map_err(io)?;
        #[cfg(test)]
        test_stage("before_commit")?;
        commit_search(tx)?;
        #[cfg(test)]
        test_stage("after_commit")?;
        Ok(result)
    }
}
