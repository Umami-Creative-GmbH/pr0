impl LibraryStore {
    pub fn organize(&mut self, request: OrganizeRequest) -> Result<Value, String> {
        let (entity, id, input) = request.action.parts();
        if !super::local_contract::uuid4(id) || !super::local_contract::uuid4(&request.operation_id)
        {
            return Err("invalid_input".into());
        }
        let fingerprint = serde_json::to_string(&(&request.action, &request.replaces))
            .map_err(|_| "invalid_input")?;
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(io)?;
        let prior: Option<(String, String)> = tx
            .query_row(
                "SELECT fingerprint,result FROM organization_receipt WHERE id=?1",
                [&request.operation_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(io)?;
        if let Some((hash, result)) = prior {
            if hash != fingerprint {
                return Err("operation_identity_reused".into());
            }
            return serde_json::from_str(&result).map_err(|_| "storage_unavailable".into());
        }
        if let Some(expected) = &request.expected_local_revision {
            let current: i64 = tx
                .query_row("SELECT revision FROM local_state", [], |r| r.get(0))
                .map_err(io)?;
            if current.to_string() != *expected {
                return Err("results_changed".into());
            }
        } else if !matches!(
            request.action,
            OrganizationAction::CreateCollection { .. } | OrganizationAction::CreateTag { .. }
        ) {
            return Err("results_changed".into());
        }
        let replacement_revision = if let Some(replaces) = &request.replaces {
            let row:Option<(String,i64)>=tx.query_row("SELECT entity_id,local_revision FROM organization_queue WHERE id=?1 AND receipt IS NULL AND (envelope IS NULL OR error IS NOT NULL)",[replaces],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(io)?;
            let (previous, revision) = row.ok_or("outcome_uncertain")?;
            if previous != id {
                return Err("invalid_input".into());
            }
            tx.execute("DELETE FROM organization_queue WHERE id=?1", [replaces])
                .map_err(io)?;
            project_organization(&tx)?;
            Some(revision)
        } else {
            None
        };
        let action = serde_json::to_value(&request.action).map_err(|_| "invalid_input")?;
        let kind = action["kind"].as_str().ok_or("invalid_input")?;
        let creating = kind.ends_with(".create");
        let entries = organization_entries(&tx, entity)?;
        let existing = entries.iter().find(|e| e.id == id);
        let mut resolved = id.to_owned();
        if entity != "prompt" {
            if creating
                && (existing.is_some()
                    || tx
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM organization_removed WHERE id=?1)",
                            [id],
                            |r| r.get::<_, bool>(0),
                        )
                        .map_err(io)?)
            {
                return Err("identity_unavailable".into());
            }
            if !creating && existing.is_none() {
                return Err("organization_unavailable".into());
            }
        }
        let base_revision = organization_base_revision(&tx)?;
        let mut operation = json!({"kind":kind,"operationId":request.operation_id,"baseRevision":base_revision,"dependsOn":[]});
        operation[format!("{entity}Id")] = json!(id);
        let mut result = json!({"id":id,"existing":false,"effect":null});
        if let Some(input) = input {
            let name = super::local_search::trim_name(input);
            if name.is_empty() || name.contains('\0') || name.chars().count() > 60 {
                return Err("validation_name".into());
            }
            let identity = super::local_search::organization_identity(name);
            if let Some(collision) = entries.iter().find(|e| {
                e.id != id && super::local_search::organization_identity(&e.name) == identity
            }) {
                if kind != "tag.create" {
                    return Err("name_conflict".into());
                }
                resolved = collision.id.clone();
                result["id"] = json!(resolved);
                result["existing"] = json!(true);
            } else {
                if creating && entries.len() >= if entity == "collection" { 200 } else { 1000 } {
                    return Err(format!("quota_{entity}"));
                }
                let delta = name.len() as i64 - existing.map_or(0, |e| e.name.len()) as i64;
                if delta > 0 && known_usage(&tx)?.1 + delta > 104857600 {
                    return Err("quota_text".into());
                }
                operation["name"] = json!(name);
            }
        }
        match &request.action {
            OrganizationAction::AssignCollection { collection_id, .. } => {
                if let Some(id) = collection_id {
                    if !organization_entries(&tx, "collection")?
                        .iter()
                        .any(|e| &e.id == id)
                    {
                        return Err("organization_unavailable".into());
                    }
                }
                let record: String = tx
                    .query_row("SELECT record FROM visible_prompt WHERE id=?1", [id], |r| {
                        r.get(0)
                    })
                    .map_err(io)?;
                let prompt: Prompt =
                    serde_json::from_str(&record).map_err(|_| "storage_unavailable")?;
                operation["kind"] = json!("prompt.update");
                operation["base"] = json!({"title":prompt.title,"description":prompt.description,"content":prompt.content,"collectionId":prompt.collection_id});
                operation["desired"] = operation["base"].clone();
                operation["desired"]["collectionId"] = json!(collection_id);
                operation["changedFields"] = json!(["collectionId"]);
            }
            OrganizationAction::AssignTags { add, remove, .. } => {
                let tags = organization_entries(&tx, "tag")?;
                let mut seen = std::collections::HashSet::new();
                if add.len() > 20
                    || remove.len() > 20
                    || add.iter().chain(remove).any(|id| {
                        !super::local_contract::uuid4(id)
                            || !seen.insert(id)
                            || !tags.iter().any(|e| &e.id == id)
                    })
                {
                    return Err("invalid_input".into());
                }
                let record: String = tx
                    .query_row("SELECT record FROM visible_prompt WHERE id=?1", [id], |r| {
                        r.get(0)
                    })
                    .map_err(io)?;
                let prompt: Prompt =
                    serde_json::from_str(&record).map_err(|_| "storage_unavailable")?;
                let mut next = prompt
                    .tag_ids
                    .into_iter()
                    .filter(|id| !remove.contains(id))
                    .collect::<std::collections::HashSet<_>>();
                next.extend(add.iter().cloned());
                if next.len() > 20 {
                    return Err("quota_tags_per_prompt".into());
                }
                operation["add"] = json!(add);
                operation["remove"] = json!(remove);
            }
            OrganizationAction::DeleteCollection { .. }
            | OrganizationAction::DeleteTag { .. }
            | OrganizationAction::MergeTag { .. } => {
                let target = action["targetId"].as_str();
                if target == Some(id) {
                    return Err("invalid_input".into());
                }
                result["effect"] = organization_effect(&tx, kind, id, target)?;
                if let Some(target) = target {
                    operation["targetId"] = json!(target);
                }
                let query = if entity == "collection" {
                    "INSERT INTO organization_affected SELECT ?1,id,archived FROM visible_prompt WHERE json_extract(record,'$.collectionId')=?2"
                } else {
                    "INSERT INTO organization_affected SELECT ?1,id,archived FROM visible_prompt WHERE EXISTS(SELECT 1 FROM json_each(record,'$.tagIds') WHERE value=?2)"
                };
                tx.execute(query, params![request.operation_id, id])
                    .map_err(io)?;
            }
            _ => {}
        }
        if resolved == id {
            operation["dependsOn"] = json!(organization_dependencies(&tx, &operation)?);
            if entity == "prompt" {
                let parent:Option<(String,String)>=tx.query_row("SELECT id,payload FROM outbox WHERE prompt_id=?1 AND state='unsent' AND json_extract(payload,'$.kind')='prompt.create'",[id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(io)?;
                if let Some((parent_id, payload)) = parent {
                    let mut parent: Value =
                        serde_json::from_str(&payload).map_err(|_| "storage_unavailable")?;
                    let dependencies = operation["dependsOn"]
                        .as_array()
                        .ok_or("storage_unavailable")?;
                    let mut observed = parent["dependsOn"]
                        .as_array()
                        .ok_or("storage_unavailable")?
                        .clone();
                    for dependency in dependencies {
                        let is_creation:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM organization_queue WHERE id=?1 AND json_extract(payload,'$.kind') IN('collection.create','tag.create'))",[dependency.as_str()],|r|r.get(0)).map_err(io)?;
                        if is_creation && !observed.contains(dependency) {
                            observed.push(dependency.clone());
                        }
                    }
                    parent["dependsOn"] = json!(observed);
                    tx.execute(
                        "UPDATE outbox SET payload=?2 WHERE id=?1",
                        params![parent_id, parent.to_string()],
                    )
                    .map_err(io)?;
                }
            }
            let next_revision: i64 = tx
                .query_row(
                    "UPDATE local_state SET revision=revision+1 RETURNING revision",
                    [],
                    |r| r.get(0),
                )
                .map_err(io)?;
            let revision = replacement_revision.unwrap_or(next_revision);
            if let Some(replaces) = &request.replaces {
                // Successors keep their order and now depend on the corrected unsent operation.
                map_organization_identity(&tx, replaces, &request.operation_id)?;
                let mut statement=tx.prepare("WITH RECURSIVE successors(id) AS (SELECT id FROM organization_queue WHERE EXISTS(SELECT 1 FROM json_each(payload,'$.dependsOn') WHERE value=?1) UNION SELECT q.id FROM organization_queue q,json_each(q.payload,'$.dependsOn') d JOIN successors s ON s.id=d.value) SELECT id FROM successors").map_err(io)?;
                let successors = statement
                    .query_map([&request.operation_id], |r| r.get::<_, String>(0))
                    .map_err(io)?
                    .collect::<Result<std::collections::HashSet<_>, _>>()
                    .map_err(io)?;
                if let Some(dependencies) = operation["dependsOn"].as_array_mut() {
                    dependencies.retain(|d| !d.as_str().is_some_and(|id| successors.contains(id)));
                }
            }
            // Each addition carries only the causal history of its own membership. The local batch is still atomic.
            let additions = operation["add"].as_array().cloned().unwrap_or_default();
            if additions.len() > 1 {
                operation["add"] = json!([additions[0]]);
            }
            tx.execute("INSERT INTO organization_queue(id,entity_id,payload,local_revision) VALUES(?1,?2,?3,?4)",params![request.operation_id,id,operation.to_string(),revision]).map_err(io)?;
            let mut predecessor = request.operation_id.clone();
            for addition in additions.into_iter().skip(1) {
                let mut child = operation.clone();
                let child_id = uuid::Uuid::new_v4().to_string();
                child["operationId"] = json!(child_id);
                child["add"] = json!([addition]);
                child["remove"] = json!([]);
                let mut dependencies = child["dependsOn"]
                    .as_array()
                    .ok_or("storage_unavailable")?
                    .clone();
                dependencies.push(json!(predecessor));
                if dependencies.len() > 100 {
                    return Err("organization_pending_limit".into());
                }
                child["dependsOn"] = json!(dependencies);
                let child_revision: i64 = tx
                    .query_row(
                        "UPDATE local_state SET revision=revision+1 RETURNING revision",
                        [],
                        |r| r.get(0),
                    )
                    .map_err(io)?;
                tx.execute("INSERT INTO organization_queue(id,entity_id,payload,local_revision) VALUES(?1,?2,?3,?4)",params![child_id,id,child.to_string(),child_revision]).map_err(io)?;
                predecessor = child_id;
            }
            // Work saved against the retained pre-recovery baseline needs the same review as prompt edits.
            tx.execute("UPDATE organization_queue SET error='recovery_required',next_attempt=9223372036854775807 WHERE local_revision>=?1 AND EXISTS(SELECT 1 FROM recovery_archive WHERE snapshot=(SELECT active FROM state))", [revision]).map_err(io)?;
            project_organization(&tx)?;
        } else if let Some(replaced) = &request.replaces {
            // A successful identity reuse settles the failed creation dependency without inventing a server receipt.
            let mut statement = tx
                .prepare("WITH RECURSIVE successors(id) AS (SELECT id FROM organization_queue WHERE EXISTS(SELECT 1 FROM json_each(payload,'$.dependsOn') WHERE value=?2) UNION SELECT q.id FROM organization_queue q,json_each(q.payload,'$.dependsOn') d JOIN successors s ON s.id=d.value) SELECT id FROM organization_queue WHERE entity_id=?1 AND id NOT IN(SELECT id FROM successors)")
                .map_err(io)?;
            let parents = statement
                .query_map(params![resolved, replaced], |r| r.get::<_, String>(0))
                .map_err(io)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(io)?;
            map_organization_identity(&tx, id, &resolved)?;
            for table in ["organization_queue", "outbox"] {
                let query = if table == "outbox" {
                    "SELECT payload FROM outbox WHERE state='unsent'"
                } else {
                    "SELECT payload FROM organization_queue WHERE envelope IS NULL"
                };
                for mut dependent in organization_rows(&tx, query)? {
                    let own = dependent["operationId"]
                        .as_str()
                        .ok_or("storage_unavailable")?
                        .to_owned();
                    let dependencies = dependent["dependsOn"]
                        .as_array_mut()
                        .ok_or("storage_unavailable")?;
                    if !dependencies.iter().any(|v| v.as_str() == Some(replaced)) {
                        continue;
                    }
                    dependencies.retain(|v| v.as_str() != Some(replaced));
                    for parent in &parents {
                        if parent != &own && !dependencies.contains(&json!(parent)) {
                            dependencies.push(json!(parent));
                        }
                    }
                    let update = if table == "outbox" {
                        "UPDATE outbox SET payload=?2 WHERE id=?1"
                    } else {
                        "UPDATE organization_queue SET payload=?2 WHERE id=?1"
                    };
                    tx.execute(update, params![own, dependent.to_string()])
                        .map_err(io)?;
                }
            }
            tx.execute("UPDATE local_state SET revision=revision+1", [])
                .map_err(io)?;
            project_organization(&tx)?;
        }
        tx.execute(
            "INSERT INTO organization_receipt VALUES(?1,?2,?3)",
            params![request.operation_id, fingerprint, result.to_string()],
        )
        .map_err(io)?;
        #[cfg(test)]
        test_stage("before_commit")?;
        tx.commit().map_err(io)?;
        Ok(result)
    }
}
fn organization_dependencies(db: &Connection, operation: &Value) -> Result<Vec<String>, String> {
    let mut ids = vec![];
    for key in ["collectionId", "tagId", "promptId", "targetId"] {
        if let Some(id) = operation[key].as_str() {
            ids.push(id.to_owned());
        }
    }
    if let Some(id) = operation["desired"]["collectionId"].as_str() {
        ids.push(id.to_owned());
    }
    for key in ["add", "remove"] {
        if let Some(values) = operation[key].as_array() {
            ids.extend(values.iter().filter_map(Value::as_str).map(str::to_owned));
        }
    }
    let mut dependencies = std::collections::BTreeSet::new();
    for id in ids {
        let mut stmt=db.prepare("SELECT id FROM organization_queue WHERE entity_id=?1 UNION ALL SELECT id FROM outbox WHERE prompt_id=?1 AND state<>'accepted_awaiting_download'").map_err(io)?;
        for value in stmt
            .query_map([id], |r| r.get::<_, String>(0))
            .map_err(io)?
        {
            dependencies.insert(value.map_err(io)?);
        }
    }
    if dependencies.len() > 100 {
        return Err("organization_pending_limit".into());
    }
    Ok(dependencies.into_iter().collect())
}
fn organization_effect(
    db: &Connection,
    kind: &str,
    id: &str,
    target: Option<&str>,
) -> Result<Value, String> {
    let entity = if kind == "collection.delete" {
        "collection"
    } else {
        "tag"
    };
    let entries = organization_entries(db, entity)?;
    let source = entries
        .iter()
        .find(|e| e.id == id)
        .ok_or("organization_unavailable")?;
    let target_entry = target
        .map(|id| {
            entries
                .iter()
                .find(|e| e.id == id)
                .ok_or("organization_unavailable")
        })
        .transpose()?;
    let (active, archived) = if let Some(target) = target {
        db.query_row("SELECT coalesce(sum(NOT archived),0),coalesce(sum(archived),0) FROM visible_prompt WHERE EXISTS(SELECT 1 FROM json_each(record,'$.tagIds') WHERE value=?1 OR value=?2)",params![id,target],|r|Ok((r.get::<_,u32>(0)?,r.get::<_,u32>(1)?))).map_err(io)?
    } else {
        (0, 0)
    };
    Ok(
        json!({"kind":kind,"sourceId":id,"sourceName":source.name,"targetId":target,"targetName":target_entry.map(|e|&e.name),"activeCount":source.active_count,"archivedCount":source.archived_count,"targetActiveCount":active,"targetArchivedCount":archived}),
    )
}
