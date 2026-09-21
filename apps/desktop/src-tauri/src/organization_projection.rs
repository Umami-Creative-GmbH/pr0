fn project_organization(tx: &rusqlite::Transaction) -> Result<(), String> {
    tx.execute_batch("INSERT OR IGNORE INTO organization_known SELECT id FROM organization_local; DELETE FROM organization_local; INSERT INTO organization_local SELECT kind,id,name,json_extract(record,'$.revision') FROM organization WHERE snapshot=(SELECT active FROM state); DELETE FROM organization_removed WHERE local=1; DELETE FROM organization_assignment;
        INSERT INTO organization_assignment SELECT v.id,json_extract(coalesce(p.record,v.record),'$.collectionId'),json_extract(coalesce(p.record,v.record),'$.tagIds'),json_extract(coalesce(p.record,v.record),'$.modifiedAt') FROM base_visible_prompt v LEFT JOIN prompt p ON p.id=v.id AND p.snapshot=(SELECT active FROM state);").map_err(io)?;
    let operations=organization_rows(tx,"SELECT json_set(payload,'$._modified',occurred_at,'$._receipt',json(receipt)) FROM organization_queue ORDER BY local_revision")?;
    for op in operations {
        let kind = op["kind"].as_str().ok_or("storage_unavailable")?;
        let entity = if kind.starts_with("collection.") {
            "collection"
        } else {
            "tag"
        };
        let original_id = op[format!("{entity}Id")].as_str().unwrap_or("");
        let id = op["_receipt"]["resolvedTagId"]
            .as_str()
            .unwrap_or(original_id);
        if kind.ends_with(".create") || kind.ends_with(".rename") {
            let deleted: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM organization_removed WHERE id=?1)",
                    [id],
                    |r| r.get(0),
                )
                .map_err(io)?;
            if deleted {
                continue;
            }
            let name = op["name"].as_str().ok_or("storage_unavailable")?;
            if kind.ends_with(".create") {
                tx.execute(
                    "INSERT OR IGNORE INTO organization_local VALUES(?1,?2,?3,?4)",
                    params![entity, id, name, op["baseRevision"].as_str()],
                )
                .map_err(io)?;
            } else {
                tx.execute(
                    "UPDATE organization_local SET name=?2 WHERE id=?1",
                    params![id, name],
                )
                .map_err(io)?;
            }
        } else if kind == "prompt.tags" {
            let prompt_id = op["promptId"].as_str().ok_or("storage_unavailable")?;
            let tags: Option<String> = tx
                .query_row(
                    "SELECT tags FROM organization_assignment WHERE id=?1",
                    [prompt_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(io)?;
            if let Some(tags) = tags {
                let mut tags: Vec<String> =
                    serde_json::from_str(&tags).map_err(|_| "storage_unavailable")?;
                let removes = op["remove"].as_array().ok_or("storage_unavailable")?;
                let before = tags.clone();
                let removal_targets = removes
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|id| resolve_local_tag(tx, id))
                    .collect::<Result<Vec<_>, _>>()?;
                tags.retain(|id| {
                    !removal_targets
                        .iter()
                        .any(|v| v.as_ref().is_some_and(|path| path.contains(id)))
                });
                for add in op["add"].as_array().ok_or("storage_unavailable")? {
                    let id = add.as_str().ok_or("storage_unavailable")?;
                    let Some(path) = resolve_local_tag(tx, id)? else {
                        continue;
                    };
                    let base = op["baseRevision"]
                        .as_str()
                        .ok_or("storage_unavailable")?
                        .parse::<i64>()
                        .map_err(|_| "storage_unavailable")?;
                    let mut removed = false;
                    for member in &path {
                        if tx.query_row("SELECT EXISTS(SELECT 1 FROM organization_membership_removal WHERE prompt_id=?1 AND tag_id=?2 AND revision>?3)",params![prompt_id,member,base],|r|r.get::<_,bool>(0)).map_err(io)? {removed=true;break;}
                    }
                    if removed {
                        continue;
                    }
                    if let Some(target) = path.last() {
                        if !tags.contains(target) {
                            tags.push(target.clone());
                        }
                    }
                }
                tags.sort();
                tx.execute("UPDATE organization_assignment SET tags=?2,modified=CASE WHEN ?3 THEN max(strftime('%Y-%m-%dT%H:%M:%fZ',modified,'+0.001 seconds'),?4) ELSE modified END WHERE id=?1",params![prompt_id,json!(tags).to_string(),before!=tags,op["_modified"].as_str()]).map_err(io)?;
            }
        } else if kind == "prompt.update" {
            tx.execute("UPDATE organization_assignment SET modified=CASE WHEN collection_id IS NOT ?2 THEN max(strftime('%Y-%m-%dT%H:%M:%fZ',modified,'+0.001 seconds'),?3) ELSE modified END,collection_id=?2 WHERE id=?1",params![op["promptId"].as_str(),op["desired"]["collectionId"].as_str(),op["_modified"].as_str()]).map_err(io)?;
        } else {
            let source: Option<String> = tx
                .query_row(
                    "SELECT name FROM organization_local WHERE id=?1",
                    [id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(io)?;
            let Some(name) = source else {
                continue;
            };
            let target = op["targetId"].as_str();
            tx.execute(
                "INSERT OR REPLACE INTO organization_removed VALUES(?1,?2,?3,?4,?5,1)",
                params![id, entity, name, target, op["baseRevision"].as_str()],
            )
            .map_err(io)?;
            tx.execute("DELETE FROM organization_local WHERE id=?1", [id])
                .map_err(io)?;
            if entity == "collection" {
                tx.execute("UPDATE organization_assignment SET collection_id=NULL,modified=max(strftime('%Y-%m-%dT%H:%M:%fZ',modified,'+0.001 seconds'),?2) WHERE collection_id=?1",params![id,op["_modified"].as_str()]).map_err(io)?;
            } else {
                let mut stmt=tx.prepare("SELECT id,tags FROM organization_assignment WHERE EXISTS(SELECT 1 FROM json_each(tags) WHERE value=?1)").map_err(io)?;
                let rows = stmt
                    .query_map([id], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })
                    .map_err(io)?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(io)?;
                for (prompt, tags) in rows {
                    let mut tags: Vec<String> =
                        serde_json::from_str(&tags).map_err(|_| "storage_unavailable")?;
                    tags.retain(|t| t != id);
                    if let Some(target) = target {
                        if !tags.iter().any(|t| t == target) {
                            tags.push(target.into());
                        }
                    }
                    tags.sort();
                    tx.execute("UPDATE organization_assignment SET tags=?2,modified=max(strftime('%Y-%m-%dT%H:%M:%fZ',modified,'+0.001 seconds'),?3) WHERE id=?1",params![prompt,json!(tags).to_string(),op["_modified"].as_str()]).map_err(io)?;
                }
            }
        }
    }
    // True deletion wins over stale assignments, including a deleted merge target.
    tx.execute("UPDATE organization_assignment SET collection_id=NULL WHERE collection_id NOT IN(SELECT id FROM organization_local WHERE kind='collection')",[]).map_err(io)?;
    tx.execute("UPDATE organization_assignment SET tags=(SELECT coalesce(json_group_array(value),'[]') FROM json_each(tags) WHERE value IN(SELECT id FROM organization_local WHERE kind='tag'))",[]).map_err(io)?;
    // Projection replay replaces its intermediate rows. Queue only final changes,
    // using compact assignments so a name-only rename never rewrites prompt metadata.
    tx.execute("INSERT INTO search_dirty SELECT a.id,0 FROM organization_assignment a LEFT JOIN search_metadata m ON m.id=a.id WHERE m.id IS NULL OR m.collection_id IS NOT a.collection_id OR m.tags<>a.tags OR m.modified<a.modified ON CONFLICT(id) DO NOTHING",[]).map_err(io)?;
    Ok(())
}
fn resolve_local_tag(db: &Connection, id: &str) -> Result<Option<Vec<String>>, String> {
    let mut path = vec![];
    let mut current = id.to_owned();
    loop {
        if path.contains(&current) {
            return Err("organization_alias_cycle".into());
        }
        path.push(current.clone());
        let removed: Option<Option<String>> = db
            .query_row(
                "SELECT target FROM organization_removed WHERE id=?1",
                [&current],
                |r| r.get(0),
            )
            .optional()
            .map_err(io)?;
        match removed {
            Some(Some(target)) => current = target,
            Some(None) => return Ok(None),
            None => {
                return Ok(db.query_row("SELECT EXISTS(SELECT 1 FROM organization_local WHERE kind='tag' AND id=?1)",[&current],|r|r.get::<_,bool>(0)).map_err(io)?.then_some(path));
            }
        }
    }
}
