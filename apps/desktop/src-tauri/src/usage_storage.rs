use super::usage_contract::{Usage, UsageStatus};
impl LibraryStore {
    pub fn usage_attempt(&self, error: Option<&str>) -> Result<(), String> {
        if let Some(error) = error {
            let attempts: u32 = self
                .db
                .query_row("SELECT attempts FROM usage_state", [], |r| r.get(0))
                .map_err(io)?;
            let delay = error
                .strip_prefix("retry_after:")
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or((2_i64.pow(attempts.min(8)) * 2).min(300))
                .clamp(1, 86400);
            self.db
                .execute(
                    "UPDATE usage_state SET attempts=min(attempts+1,9),next_attempt=?1,error=?2",
                    params![
                        now() + delay * 1000 + (uuid::Uuid::new_v4().as_u128() % 1000) as i64,
                        error
                    ],
                )
                .map_err(io)?;
        } else {
            self.db
                .execute(
                    "UPDATE usage_state SET attempts=0,next_attempt=0,error=NULL",
                    [],
                )
                .map_err(io)?;
        }
        Ok(())
    }
    pub fn prepare_usage(&mut self) -> Result<Option<(serde_json::Value, bool)>, String> {
        if self.recovering()? { return Ok(None); }
        let tx = self.db.transaction().map_err(io)?;
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
        // A local create must be accepted before its use is sent. A usage event never retargets to a conflict copy.
        let row:Option<(String,String,String,Option<String>)>=tx.query_row("SELECT id,prompt_id,occurred_at,envelope FROM pending_usage u WHERE receipt IS NULL AND recovery=0 AND NOT EXISTS(SELECT 1 FROM outbox o WHERE o.prompt_id=u.prompt_id AND json_extract(o.payload,'$.kind')='prompt.create' AND o.state<>'accepted_awaiting_download') ORDER BY rowid LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(io)?;
        let Some((id, prompt, occurred, frozen)) = row else {
            return Ok(None);
        };
        let replay = frozen.is_some();
        let body = match frozen {
            Some(body) => body,
            None => {
                let installation: String = tx
                    .query_row("SELECT installation FROM local_state", [], |r| r.get(0))
                    .map_err(io)?;
                serde_json::json!({"protocolVersion":1,"instanceId":self.instance,"accountId":self.account,"epoch":manifest.epoch,"installationId":installation,"operations":[{"kind":"prompt.use","operationId":id,"promptId":prompt,"baseRevision":"0","dependsOn":[],"occurredAt":occurred}]}).to_string()
            }
        };
        tx.execute(
            "UPDATE pending_usage SET envelope=?2 WHERE id=?1",
            params![id, body],
        )
        .map_err(io)?;
        commit_search(tx)?;
        Ok(Some((
            serde_json::from_str(&body).map_err(|_| "storage_unavailable")?,
            replay,
        )))
    }
    pub fn acknowledge_usage(
        &mut self,
        body: &serde_json::Value,
        outcome: Outcome,
    ) -> Result<(), String> {
        let operation = &body["operations"][0];
        let id = operation["operationId"]
            .as_str()
            .ok_or("invalid_response")?;
        if self.db.query_row("SELECT EXISTS(SELECT 1 FROM pending_usage WHERE id=?1 AND recovery=1)",[id],|r|r.get::<_,bool>(0)).map_err(io)? { return Err("recovery_required".into()); }
        let receipt = match outcome {
            Outcome::Accepted(receipt) => receipt,
            Outcome::Rejected { error } => {
                if error.operation_id != id || error.code.len() > 100 {
                    return Err("invalid_response".into());
                }
                return Err(error
                    .retry_after
                    .map_or(error.code, |s| format!("retry_after:{s}")));
            }
            _ => return Err("invalid_response".into()),
        };
        let valid_date = |s: &str| {
            s.len() == 24
                && !s.starts_with("0000-")
                && s.ends_with('Z')
                && chrono::DateTime::parse_from_rfc3339(s).is_ok()
        };
        if receipt.operation_id != id
            || Some(receipt.prompt_id.as_str()) != operation["promptId"].as_str()
            || receipt
                .revision
                .parse::<i64>()
                .ok()
                .filter(|v| *v >= 0 && v.to_string() == receipt.revision)
                .is_none()
            || !valid_date(&receipt.accepted_at)
            || receipt.conflict.is_some()
            || receipt.organization_notice.is_some()
            || receipt.used_at.as_ref().is_none_or(|used| {
                !valid_date(used)
                    || used > &receipt.accepted_at
                    || Some(used.as_str()) > operation["occurredAt"].as_str()
            })
        {
            return Err("invalid_response".into());
        }
        let tx = self.db.transaction().map_err(io)?;
        tx.execute(
            "UPDATE pending_usage SET receipt=?2 WHERE id=?1",
            params![
                id,
                serde_json::to_string(&receipt).map_err(|_| "invalid_response")?
            ],
        )
        .map_err(io)?;
        let active: Option<String> = tx
            .query_row(
                "SELECT manifest FROM download WHERE complete=1 AND id=(SELECT active FROM state)",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(io)?;
        if let Some(active) = active {
            let active: Manifest =
                serde_json::from_str(&active).map_err(|_| "storage_unavailable")?;
            retire_downloaded_uploads(&tx, &active)?;
        }
        commit_search(tx)
    }
    pub fn record_usage(&mut self, usage: &Usage) -> Result<(), String> {
        #[cfg(test)]
        if TEST_FAULT.with(|fault| fault.borrow().as_str() == "usage_io_error") {
            self.db.execute_batch("PRAGMA query_only=ON").map_err(io)?;
        }
        let tx = self.db.transaction().map_err(io)?;
        tx.execute(
            "INSERT OR IGNORE INTO pending_usage(id,prompt_id,occurred_at) VALUES(?1,?2,?3)",
            params![usage.id, usage.prompt_id, usage.occurred_at],
        )
        .map_err(io)?;
        // Recency is derived from this same durable event, so it cannot commit independently.
        commit_search(tx)
    }
    pub fn project_usage(&self, prompt: &mut Prompt) -> Result<(), String> {
        let (count, used): (i64, Option<String>) = self.db.query_row(
            "SELECT coalesce((SELECT json_extract(record,'$.useCount') FROM prompt WHERE snapshot=(SELECT active FROM state) AND id=?1),0)+count(*), nullif(max(coalesce((SELECT json_extract(record,'$.lastUsedAt') FROM prompt WHERE snapshot=(SELECT active FROM state) AND id=?1),''),coalesce(max(coalesce(json_extract(receipt,'$.usedAt'),occurred_at)),'')),'') FROM pending_usage WHERE prompt_id=?1",
            [&prompt.id], |r| Ok((r.get(0)?,r.get(1)?))).map_err(io)?;
        prompt.use_count = count as u64;
        prompt.last_used_at = used;
        Ok(())
    }
    pub fn recents(&self, offset: u32) -> Result<Vec<Summary>, String> {
        if offset > 20000 {
            return Err("invalid_input".into());
        }
        let mut statement = self.db.prepare("SELECT v.id,v.title,nullif(max(coalesce(json_extract(p.record,'$.lastUsedAt'),''),coalesce(u.used,'')),'') AS used FROM visible_prompt v LEFT JOIN prompt p ON p.id=v.id AND p.snapshot=(SELECT active FROM state) LEFT JOIN (SELECT prompt_id,max(coalesce(json_extract(receipt,'$.usedAt'),occurred_at)) AS used FROM pending_usage GROUP BY prompt_id) u ON u.prompt_id=v.id WHERE v.archived=0 AND (json_extract(p.record,'$.lastUsedAt') IS NOT NULL OR u.used IS NOT NULL)").map_err(io)?;
        let mut rows = statement
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        rows.sort_by_cached_key(|(id, title, used)| {
            (
                std::cmp::Reverse(used.clone()),
                super::local_search::normalize(title),
                id.clone(),
            )
        });
        rows
            .into_iter()
            .skip(offset as usize)
            .take(50)
            .map(|(id, title, _)| {
                let excerpt = self.db.query_row(
                    "SELECT json_extract(record,'$.content') FROM visible_prompt WHERE id=?1",
                    [&id],
                    |r| Ok(super::excerpt::excerpt(&r.get::<_, String>(0)?)),
                ).map_err(io)?;
                Ok(Summary { excerpt, id, title, archived: false })
            })
            .collect()
    }
    pub fn usage_status(&self) -> Result<UsageStatus, String> {
        self.db.query_row("SELECT (SELECT count(*) FROM pending_usage WHERE receipt IS NULL),(SELECT count(*) FROM pending_usage WHERE receipt IS NOT NULL),CASE WHEN EXISTS(SELECT 1 FROM pending_usage WHERE recovery=1) THEN 'recovery_required' ELSE error END,max(0,next_attempt-?1) FROM usage_state",[now()],|r| Ok(UsageStatus {waiting:r.get(0)?,awaiting_download:r.get(1)?,memory_only:0,error:r.get(2)?,retry_after_ms:r.get::<_,i64>(3)? as u64})).map_err(io)
    }
}
