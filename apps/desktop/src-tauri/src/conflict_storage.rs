// Included in library_storage; acknowledgement and its upload are one local commit.
fn retain_adjustment(tx: &rusqlite::Transaction, receipt: &Value) -> Result<(), String> {
    if let Some(message) = receipt["organizationNotice"].as_str() {
        let notice = super::conflict_contract::AdjustmentNotice {
            id: receipt["operationId"]
                .as_str()
                .ok_or("invalid_response")?
                .into(),
            prompt_id: receipt["promptId"]
                .as_str()
                .ok_or("invalid_response")?
                .into(),
            revision: receipt["revision"]
                .as_str()
                .ok_or("invalid_response")?
                .into(),
            created_at: receipt["acceptedAt"]
                .as_str()
                .ok_or("invalid_response")?
                .into(),
            message: message.into(),
        };
        tx.execute("INSERT INTO organization_adjustment(id,record) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET record=excluded.record",params![notice.id,serde_json::to_string(&notice).map_err(|_|"invalid_response")?]).map_err(io)?;
    }
    Ok(())
}
impl LibraryStore {
    pub fn has_conflicts(&self) -> Result<bool,String> {
        self.db.query_row("SELECT EXISTS(SELECT 1 FROM conflict_notice WHERE reviewed=0)",[],|r|r.get(0)).map_err(io)
    }
    pub fn has_adjustments(&self) -> Result<bool,String> {
        self.db.query_row("SELECT EXISTS(SELECT 1 FROM organization_adjustment WHERE reviewed=0)",[],|r|r.get(0)).map_err(io)
    }
    pub fn begin_attention(&self, kind: &str) -> Result<(), String> {
        self.db
            .execute("DELETE FROM attention_staging WHERE kind=?1", [kind])
            .map_err(io)?;
        Ok(())
    }
    pub fn stage_attention<T: serde::Serialize>(
        &mut self,
        kind: &str,
        notices: &[T],
    ) -> Result<(), String> {
        let tx = self.db.transaction().map_err(io)?;
        for notice in notices {
            let record = serde_json::to_value(notice).map_err(|_| "invalid_response")?;
            let id = record["id"].as_str().ok_or("invalid_response")?;
            tx.execute(
                "INSERT INTO attention_staging(kind,id,record) VALUES(?1,?2,?3)",
                params![kind, id, record.to_string()],
            )
            .map_err(|_| "invalid_response")?;
        }
        tx.commit().map_err(io)
    }
    pub fn finish_attention(&mut self, kind: &str, revision: &str) -> Result<(), String> {
        let table = match kind {
            "conflicts" => "conflict_notice",
            "adjustments" => "organization_adjustment",
            _ => return Err("invalid_input".into()),
        };
        let tx = self.db.transaction().map_err(io)?;
        tx.execute(&format!("UPDATE {table} SET reviewed=1 WHERE reviewed=0 AND cast(json_extract(record,'$.revision') AS INTEGER)<=?1"),[super::change_contract::revision(revision)?]).map_err(io)?;
        tx.execute(&format!("INSERT INTO {table}(id,record,reviewed) SELECT s.id,s.record,EXISTS(SELECT 1 FROM conflict_reviewed r WHERE r.id=s.id) FROM attention_staging s WHERE kind=?1 ON CONFLICT(id) DO UPDATE SET record=excluded.record,reviewed=excluded.reviewed"),[kind]).map_err(io)?;
        tx.execute("DELETE FROM attention_staging WHERE kind=?1", [kind])
            .map_err(io)?;
        tx.commit().map_err(io)
    }
    pub fn adjustments(&self, offset: u32) -> Result<Value, String> {
        let mut statement = self.db.prepare("SELECT record FROM organization_adjustment WHERE reviewed=0 ORDER BY cast(json_extract(record,'$.revision') AS INTEGER) DESC,id LIMIT 101 OFFSET ?1").map_err(io)?;
        let records = statement
            .query_map([offset], |r| r.get::<_, String>(0))
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        let more = records.len() > 100;
        let notices = records
            .into_iter()
            .take(100)
            .map(|record| serde_json::from_str::<Value>(&record).map_err(|_| "storage_unavailable"))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(
            json!({"instanceId":self.instance,"accountId":self.account,"notices":notices,"nextOffset":if more {Some(offset+100)} else {None}}),
        )
    }
    pub fn review_adjustment(&mut self, id: &str) -> Result<(), String> {
        if !super::local_contract::uuid4(id) {
            return Err("invalid_input".into());
        }
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(io)?;
        let (record, reviewed): (String, bool) = tx
            .query_row(
                "SELECT record,reviewed FROM organization_adjustment WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(io)?
            .ok_or("notice_unavailable")?;
        if reviewed {
            tx.execute("UPDATE organization_queue SET next_attempt=0 WHERE json_extract(payload,'$.noticeId')=?1 AND receipt IS NULL AND error IS NOT 'recovery_required'",[id]).map_err(io)?;
            return tx.commit().map_err(io);
        }
        let notice: super::conflict_contract::AdjustmentNotice =
            serde_json::from_str(&record).map_err(|_| "storage_unavailable")?;
        let revision: i64 = tx
            .query_row(
                "UPDATE local_state SET revision=revision+1 RETURNING revision",
                [],
                |r| r.get(0),
            )
            .map_err(io)?;
        let operation = json!({"kind":"organization.review","operationId":uuid::Uuid::new_v4().to_string(),"promptId":notice.prompt_id,"noticeId":id,"baseRevision":notice.revision,"dependsOn":[]});
        tx.execute("INSERT INTO organization_queue(id,entity_id,payload,local_revision) VALUES(?1,?2,?3,?4)",params![operation["operationId"].as_str(),id,operation.to_string(),revision]).map_err(io)?;
        tx.execute(
            "UPDATE organization_adjustment SET reviewed=1 WHERE id=?1",
            [id],
        )
        .map_err(io)?;
        tx.execute("INSERT OR IGNORE INTO conflict_reviewed VALUES(?1)", [id])
            .map_err(io)?;
        tx.commit().map_err(io)
    }
    pub fn conflict_error(&self, error: Option<&str>) -> Result<(), String> {
        self.db
            .execute("UPDATE conflict_state SET error=?1", [error])
            .map_err(io)?;
        Ok(())
    }
    pub fn adjustment_error(&self, error: Option<&str>) -> Result<(), String> {
        self.db
            .execute("UPDATE conflict_state SET adjustment_error=?1", [error])
            .map_err(io)?;
        Ok(())
    }
    pub fn conflicts(&self, offset: u32) -> Result<Value, String> {
        let mut statement = self.db.prepare("SELECT record FROM conflict_notice WHERE reviewed=0 ORDER BY cast(json_extract(record,'$.revision') AS INTEGER) DESC,id LIMIT 101 OFFSET ?1").map_err(io)?;
        let records = statement
            .query_map([offset], |r| r.get::<_, String>(0))
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        let more = records.len() > 100;
        let mut notices = vec![];
        for record in records.into_iter().take(100) {
            let mut notice: Value =
                serde_json::from_str(&record).map_err(|_| "storage_unavailable")?;
            for (key, available, archived) in [
                ("originalId", "originalAvailable", true),
                ("copyId", "copyAvailable", false),
            ] {
                let prompt_archived: Option<bool> = self.db.query_row("SELECT archived FROM visible_prompt WHERE id=?1",[notice[key].as_str().ok_or("storage_unavailable")?],|r|r.get(0)).optional().map_err(io)?;
                notice[available] = json!(prompt_archived.is_some());
                if archived && prompt_archived.is_some() {
                    notice["originalArchived"] = json!(prompt_archived);
                }
            }
            notices.push(notice);
        }
        let error: Option<String> = self
            .db
            .query_row("SELECT error FROM conflict_state", [], |r| r.get(0))
            .map_err(io)?;
        Ok(
            json!({"instanceId":self.instance,"accountId":self.account,"notices":notices,"error":error,"nextOffset":if more {Some(offset+100)} else {None}}),
        )
    }
    pub fn review_conflict(&mut self, id: &str) -> Result<(), String> {
        if !super::local_contract::uuid4(id) {
            return Err("invalid_input".into());
        }
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(io)?;
        let row: Option<(String, bool)> = tx
            .query_row(
                "SELECT record,reviewed FROM conflict_notice WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(io)?;
        let (record, reviewed) = row.ok_or("notice_unavailable")?;
        if reviewed {
            tx.execute("UPDATE organization_queue SET next_attempt=0 WHERE json_extract(payload,'$.noticeId')=?1 AND receipt IS NULL AND error IS NOT 'recovery_required'",[id]).map_err(io)?;
            return tx.commit().map_err(io);
        }
        let notice: super::conflict_contract::ConflictNotice =
            serde_json::from_str(&record).map_err(|_| "storage_unavailable")?;
        let revision: i64 = tx
            .query_row(
                "UPDATE local_state SET revision=revision+1 RETURNING revision",
                [],
                |r| r.get(0),
            )
            .map_err(io)?;
        let operation = json!({"kind":"conflict.review","operationId":uuid::Uuid::new_v4().to_string(),"promptId":notice.copy_id,"noticeId":id,"baseRevision":notice.revision,"dependsOn":[]});
        tx.execute("INSERT INTO organization_queue(id,entity_id,payload,local_revision) VALUES(?1,?2,?3,?4)",params![operation["operationId"].as_str(),id,operation.to_string(),revision]).map_err(io)?;
        tx.execute("UPDATE conflict_notice SET reviewed=1 WHERE id=?1", [id])
            .map_err(io)?;
        tx.execute("INSERT OR IGNORE INTO conflict_reviewed VALUES(?1)", [id])
            .map_err(io)?;
        tx.commit().map_err(io)
    }
}
