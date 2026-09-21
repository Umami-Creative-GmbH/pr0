const READY_ORGANIZATION: &str = "SELECT q.id,q.payload,q.envelope FROM organization_queue q WHERE q.receipt IS NULL AND q.next_attempt<=?1 AND NOT EXISTS(SELECT 1 FROM json_each(q.payload,'$.dependsOn') d JOIN organization_queue p ON p.id=d.value WHERE p.receipt IS NULL) AND NOT EXISTS(SELECT 1 FROM json_each(q.payload,'$.dependsOn') d JOIN outbox p ON p.id=d.value WHERE p.state<>'accepted_awaiting_download') ORDER BY q.local_revision LIMIT 1";
fn organization_causal_revision(db: &Connection, operation: &Value) -> Result<i64, String> {
    let serialized = operation.to_string();
    if operation["kind"] != "prompt.tags" || operation["add"].as_array().is_none_or(Vec::is_empty) {
        return db.query_row("SELECT coalesce(max(a.revision),0) FROM organization_ack a JOIN json_each(?1,'$.dependsOn') d ON d.value=a.id",[serialized],|r|r.get(0)).map_err(io);
    }
    let addition = operation["add"][0].as_str().ok_or("storage_unavailable")?;
    let path = resolve_local_tag(db, addition)?.unwrap_or_else(|| vec![addition.into()]);
    let mut causal = 0;
    let mut statement=db.prepare("SELECT a.revision,a.payload FROM organization_ack a JOIN json_each(?1,'$.dependsOn') d ON d.value=a.id").map_err(io)?;
    let receipts = statement
        .query_map([serialized], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(io)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(io)?;
    for (revision, payload) in receipts {
        let predecessor: Value =
            serde_json::from_str(&payload).map_err(|_| "storage_unavailable")?;
        if predecessor["kind"] != "prompt.tags" || predecessor["promptId"] != operation["promptId"]
        {
            continue;
        }
        for removed in predecessor["remove"]
            .as_array()
            .ok_or("storage_unavailable")?
        {
            let removed = removed.as_str().ok_or("storage_unavailable")?;
            let removed_path =
                resolve_local_tag(db, removed)?.unwrap_or_else(|| vec![removed.into()]);
            if removed_path.iter().any(|id| path.contains(id)) {
                causal = causal.max(revision);
            }
        }
    }
    Ok(causal)
}
impl LibraryStore {
    pub fn organization_upload_ready(&self) -> Result<bool, String> {
        Ok(self
            .db
            .query_row(READY_ORGANIZATION, [now()], |r| r.get::<_, String>(0))
            .optional()
            .map_err(io)?
            .is_some())
    }
    pub fn is_organization_upload(&self, body: &Value) -> Result<bool, String> {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM organization_queue WHERE id=?1)",
                [body["operations"][0]["operationId"].as_str()],
                |r| r.get(0),
            )
            .map_err(io)
    }
    pub fn prepare_organization_upload(&mut self) -> Result<Option<(Value, bool)>, String> {
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
        let ready: Option<(String, String, Option<String>)> = tx
            .query_row(READY_ORGANIZATION, [now()], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()
            .map_err(io)?;
        let Some((id, payload, frozen)) = ready else {
            return Ok(None);
        };
        let replay = frozen.is_some();
        let envelope = if let Some(frozen) = frozen {
            serde_json::from_str(&frozen).map_err(|_| "storage_unavailable")?
        } else {
            let mut operation: Value =
                serde_json::from_str(&payload).map_err(|_| "storage_unavailable")?;
            let causal = organization_causal_revision(&tx, &operation)?;
            let base = super::change_contract::revision(
                operation["baseRevision"]
                    .as_str()
                    .ok_or("storage_unavailable")?,
            )?;
            operation["baseRevision"] = json!(base.max(causal).to_string());
            tx.execute(
                "UPDATE organization_queue SET payload=?2 WHERE id=?1",
                params![id, operation.to_string()],
            )
            .map_err(io)?;
            let installation: String = tx
                .query_row("SELECT installation FROM local_state", [], |r| r.get(0))
                .map_err(io)?;
            json!({"protocolVersion":1,"instanceId":self.instance,"accountId":self.account,"epoch":manifest.epoch,"installationId":installation,"operations":[operation]})
        };
        if envelope.to_string().len() > 4194304 {
            return Err("invalid_input".into());
        }
        tx.execute(
            "UPDATE organization_queue SET envelope=?2,error=NULL WHERE id=?1",
            params![id, envelope.to_string()],
        )
        .map_err(io)?;
        tx.commit().map_err(io)?;
        Ok(Some((envelope, replay)))
    }
    pub fn acknowledge_organization_upload(
        &mut self,
        body: &Value,
        result: &Value,
    ) -> Result<(), String> {
        let op = &body["operations"][0];
        let id = op["operationId"].as_str().ok_or("invalid_response")?;
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(io)?;
        let blocked: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM organization_queue WHERE id=?1 AND error='recovery_required')", [id], |r|r.get(0)).map_err(io)?;
        if blocked { return Err("recovery_required".into()); }
        let frozen: Option<String> = tx
            .query_row(
                "SELECT envelope FROM organization_queue WHERE id=?1 AND receipt IS NULL",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(io)?
            .flatten();
        let Some(frozen) = frozen else {
            return Ok(());
        };
        if serde_json::from_str::<Value>(&frozen).map_err(|_| "storage_unavailable")? != *body {
            return Err("invalid_response".into());
        }
        match result["status"].as_str() {
            Some("rejected") => {
                let failure: super::upload_contract::Failure =
                    serde_json::from_value(result["error"].clone())
                        .map_err(|_| "invalid_response")?;
                if failure.operation_id != id || failure.code.len() > 100 {
                    return Err("invalid_response".into());
                }
                let next = if failure.retryable {
                    now() + failure.retry_after.unwrap_or(60).clamp(1, 86400) as i64 * 1000
                } else {
                    i64::MAX
                };
                tx.execute(
                    "UPDATE organization_queue SET error=?2,next_attempt=?3 WHERE id=?1",
                    params![id, failure.code, next],
                )
                .map_err(io)?;
            }
            Some("accepted") => {
                if result["operationId"] != op["operationId"] {
                    return Err("invalid_response".into());
                }
                let revision = result["revision"].as_str().ok_or("invalid_response")?;
                super::change_contract::revision(revision)?;
                chrono::DateTime::parse_from_rfc3339(
                    result["acceptedAt"].as_str().ok_or("invalid_response")?,
                )
                .map_err(|_| "invalid_response")?;
                let kind = op["kind"].as_str().ok_or("invalid_response")?;
                if kind == "tag.create" || kind == "tag.rename" {
                    if result["tagId"] != op["tagId"]
                        || !matches!(
                            result["outcome"].as_str(),
                            Some("created" | "renamed" | "existing")
                        )
                    {
                        return Err("invalid_response".into());
                    }
                    let resolved = result["resolvedTagId"].as_str().ok_or("invalid_response")?;
                    if !super::local_contract::uuid4(resolved) {
                        return Err("invalid_response".into());
                    }
                    if result["resolvedTagId"] != op["tagId"] {
                        map_organization_identity(
                            &tx,
                            op["tagId"].as_str().ok_or("invalid_response")?,
                            resolved,
                        )?;
                    }
                } else if kind == "collection.create" || kind == "collection.rename" {
                    if result["collectionId"] != op["collectionId"] {
                        return Err("invalid_response".into());
                    }
                } else if kind.starts_with("prompt.") {
                    if result["promptId"] != op["promptId"] {
                        return Err("invalid_response".into());
                    }
                } else {
                    let effect: super::change_contract::Effect =
                        serde_json::from_value(result["effect"].clone())
                            .map_err(|_| "invalid_response")?;
                    if effect.kind != kind
                        || Some(effect.source_id.as_str())
                            != op[if kind.starts_with("collection.") {
                                "collectionId"
                            } else {
                                "tagId"
                            }]
                            .as_str()
                        || effect.target_id.as_deref() != op["targetId"].as_str()
                    {
                        return Err("invalid_response".into());
                    }
                }
                tx.execute(
                    "INSERT OR REPLACE INTO organization_ack VALUES(?1,?2,?3)",
                    params![
                        id,
                        revision.parse::<i64>().map_err(|_| "invalid_response")?,
                        json!({"kind":op["kind"],"promptId":op["promptId"],"remove":op["remove"]})
                            .to_string()
                    ],
                )
                .map_err(io)?;
                tx.execute(
                    "UPDATE organization_queue SET receipt=?2,error=NULL WHERE id=?1",
                    params![id, result.to_string()],
                )
                .map_err(io)?;
                tx.execute("UPDATE upload_state SET refresh=1", [])
                    .map_err(io)?;
            }
            _ => return Err("invalid_response".into()),
        }
        tx.execute("UPDATE local_state SET revision=revision+1", [])
            .map_err(io)?;
        let active: Option<String> = tx
            .query_row(
                "SELECT manifest FROM download WHERE complete=1 AND id=(SELECT active FROM state)",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(io)?;
        if let Some(active) = active {
            let manifest: Manifest =
                serde_json::from_str(&active).map_err(|_| "storage_unavailable")?;
            retire_downloaded_uploads(&tx, &manifest)?;
        }
        project_organization(&tx)?;
        tx.commit().map_err(io)
    }
}
fn replace_identity(value: &mut Value, source: &str, target: &str) {
    match value {
        Value::String(id) if id == source => *id = target.into(),
        Value::Array(values) => {
            for value in values {
                replace_identity(value, source, target);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                if matches!(
                    key.as_str(),
                    "tagId"
                        | "collectionId"
                        | "promptId"
                        | "targetId"
                        | "add"
                        | "remove"
                        | "dependsOn"
                        | "desired"
                        | "base"
                ) {
                    replace_identity(value, source, target);
                }
            }
        }
        _ => {}
    }
}
fn map_organization_identity(
    tx: &rusqlite::Transaction,
    source: &str,
    target: &str,
) -> Result<(), String> {
    // Only unsent dependants can change payload. Frozen requests retain their immutable fingerprint.
    let rows = organization_rows(
        tx,
        "SELECT payload FROM organization_queue WHERE envelope IS NULL",
    )?;
    for mut op in rows {
        replace_identity(&mut op, source, target);
        tx.execute("UPDATE organization_queue SET payload=?2,entity_id=CASE WHEN entity_id=?3 THEN ?4 ELSE entity_id END WHERE id=?1",params![op["operationId"].as_str(),op.to_string(),source,target]).map_err(io)?;
    }
    let rows = organization_rows(tx, "SELECT payload FROM outbox WHERE state='unsent'")?;
    for mut op in rows {
        replace_identity(&mut op, source, target);
        tx.execute(
            "UPDATE outbox SET payload=?2 WHERE id=?1",
            params![op["operationId"].as_str(), op.to_string()],
        )
        .map_err(io)?;
    }
    Ok(())
}
