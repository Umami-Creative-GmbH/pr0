// Included in library_storage. Organization intent and projections share its native-owned transaction.
use super::organization_contract::{OrganizationAction, OrganizeRequest};
use serde_json::{json, Value};

fn migrate_organization(db: &Connection) -> Result<(), String> {
    db.execute_batch("BEGIN IMMEDIATE;
        CREATE TABLE organization_known(id TEXT PRIMARY KEY); CREATE TABLE organization_checkpoint(revision TEXT); INSERT INTO organization_checkpoint VALUES(NULL); CREATE TABLE organization_ack(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL); CREATE TABLE organization_queue(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, payload TEXT NOT NULL, local_revision INTEGER NOT NULL, envelope TEXT, receipt TEXT, error TEXT, next_attempt INTEGER NOT NULL DEFAULT 0,occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        CREATE TABLE organization_local(kind TEXT NOT NULL,id TEXT PRIMARY KEY,name TEXT NOT NULL,revision TEXT NOT NULL);
        CREATE TABLE organization_receipt(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL);
        CREATE TABLE organization_removed(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,target TEXT,revision TEXT NOT NULL,local INTEGER NOT NULL);
        CREATE TABLE organization_affected(operation_id TEXT NOT NULL,prompt_id TEXT NOT NULL,archived INTEGER NOT NULL,PRIMARY KEY(operation_id,prompt_id));
        CREATE TABLE organization_assignment(id TEXT PRIMARY KEY,collection_id TEXT,tags TEXT NOT NULL,modified TEXT NOT NULL);
        CREATE TABLE organization_membership_removal(prompt_id TEXT NOT NULL,tag_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(prompt_id,tag_id));
        CREATE VIEW base_visible_prompt AS SELECT id,title,archived,record,text_bytes FROM local_prompt UNION ALL SELECT id,title,archived,record,text_bytes FROM prompt WHERE snapshot=(SELECT active FROM state) AND id NOT IN(SELECT id FROM local_prompt);
        DROP VIEW visible_prompt;
        CREATE VIEW visible_prompt AS SELECT p.id,p.title,p.archived,CASE WHEN a.id IS NULL THEN p.record ELSE json_set(p.record,'$.collectionId',a.collection_id,'$.tagIds',json(a.tags),'$.modifiedAt',max(json_extract(p.record,'$.modifiedAt'),a.modified)) END AS record,p.text_bytes FROM base_visible_prompt p LEFT JOIN organization_assignment a ON a.id=p.id;
        INSERT INTO organization_local SELECT kind,id,name,json_extract(record,'$.revision') FROM organization WHERE snapshot=(SELECT active FROM state);
        PRAGMA user_version=6; COMMIT;").map_err(io)
}
fn organization_entries(db: &Connection, kind: &str) -> Result<Vec<OrganizationEntry>, String> {
    let mut statement = db
        .prepare("SELECT id,name,revision FROM organization_local WHERE kind=?1")
        .map_err(io)?;
    let mut entries = statement
        .query_map([kind], |r| {
            Ok(OrganizationEntry {
                id: r.get(0)?,
                name: r.get(1)?,
                revision: r.get(2)?,
                active_count: 0,
                archived_count: 0,
                total_count: 0,
            })
        })
        .map_err(io)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(io)?;
    let query = if kind == "collection" {
        "SELECT json_extract(record,'$.collectionId'),archived,count(*) FROM visible_prompt GROUP BY 1,2"
    } else {
        "SELECT t.value,p.archived,count(*) FROM visible_prompt p,json_each(p.record,'$.tagIds') t GROUP BY 1,2"
    };
    let mut counts = db.prepare(query).map_err(io)?;
    for row in counts
        .query_map([], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, bool>(1)?,
                r.get::<_, u32>(2)?,
            ))
        })
        .map_err(io)?
    {
        let (id, archived, count) = row.map_err(io)?;
        if let Some(entry) = entries.iter_mut().find(|e| Some(&e.id) == id.as_ref()) {
            if archived {
                entry.archived_count = count;
            } else {
                entry.active_count = count;
            }
            entry.total_count += count;
        }
    }
    entries.sort_by_cached_key(|e| (super::local_search::normalize(&e.name), e.id.clone()));
    Ok(entries)
}
fn organization_rows(db: &Connection, sql: &str) -> Result<Vec<Value>, String> {
    let mut statement = db.prepare(sql).map_err(io)?;
    let records = statement
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(io)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(io)?;
    records
        .into_iter()
        .map(|r| serde_json::from_str(&r).map_err(|_| "storage_unavailable".into()))
        .collect()
}
fn organization_base_revision(db: &Connection) -> Result<String, String> {
    db.query_row("SELECT coalesce((SELECT json_extract(manifest,'$.revision') FROM download WHERE id=(SELECT active FROM state)),'0')",[],|r|r.get(0)).map_err(io)
}
fn organization_byte_delta(db: &Connection) -> Result<i64, String> {
    db.query_row("SELECT (SELECT coalesce(sum(length(cast(name AS BLOB))),0) FROM organization_local)-(SELECT coalesce(sum(length(cast(name AS BLOB))),0) FROM organization WHERE snapshot=(SELECT active FROM state))",[],|r|r.get(0)).map_err(io)
}
impl LibraryStore {
    pub fn organization_snapshot(&self) -> Result<Value, String> {
        let effects=organization_rows(&self.db,"SELECT json_object('id',r.id,'effect',json_extract(result,'$.effect'),'accepted',json(CASE WHEN EXISTS(SELECT 1 FROM organization_ack a WHERE a.id=r.id) THEN 'true' ELSE 'false' END)) FROM organization_receipt r WHERE json_extract(result,'$.effect') IS NOT NULL ORDER BY rowid DESC LIMIT 100")?;
        let pending=organization_rows(&self.db,"SELECT json_object('id',id,'operation',json(payload),'error',error,'accepted',json(CASE WHEN receipt IS NULL THEN 'false' ELSE 'true' END)) FROM organization_queue ORDER BY local_revision")?;
        let mut states=organization_rows(&self.db,"SELECT json_object('id',id,'entity',kind,'name',name,'state',CASE WHEN target IS NULL THEN 'deleted' ELSE 'merged' END,'targetId',target,'targetName',NULL) FROM organization_removed")?;
        for state in &mut states {
            let mut seen = std::collections::HashSet::new();
            let mut target = state["targetId"].as_str().map(str::to_owned);
            let mut resolved = None;
            while let Some(id) = target {
                if !seen.insert(id.clone()) {
                    break;
                }
                let name: Option<String> = self
                    .db
                    .query_row(
                        "SELECT name FROM organization_local WHERE kind='tag' AND id=?1",
                        [&id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(io)?;
                if let Some(name) = name {
                    resolved = Some((id, name));
                    break;
                }
                target = self
                    .db
                    .query_row(
                        "SELECT target FROM organization_removed WHERE id=?1",
                        [id],
                        |r| r.get::<_, Option<String>>(0),
                    )
                    .optional()
                    .map_err(io)?
                    .flatten();
            }
            state["targetId"] = json!(resolved.as_ref().map(|v| &v.0));
            state["targetName"] = json!(resolved.as_ref().map(|v| &v.1));
        }
        let local_revision: i64 = self
            .db
            .query_row("SELECT revision FROM local_state", [], |r| r.get(0))
            .map_err(io)?;
        Ok(
            json!({"instanceId":self.instance,"accountId":self.account,"revision":organization_base_revision(&self.db)?,"localRevision":local_revision.to_string(),"collections":organization_entries(&self.db,"collection")?,"tags":organization_entries(&self.db,"tag")?,"pending":pending,"effects":effects,"states":states,"textBytes":self.known_usage()?.1,"complete":self.status()?.complete}),
        )
    }
    pub fn organization_impact(
        &self,
        action: OrganizationAction,
        replaces: Option<String>,
    ) -> Result<Value, String> {
        let value = serde_json::to_value(&action).map_err(|_| "invalid_input")?;
        let kind = value["kind"].as_str().ok_or("invalid_input")?;
        if !matches!(kind, "collection.delete" | "tag.delete" | "tag.merge") {
            return Err("invalid_input".into());
        }
        let revision: i64 = self
            .db
            .query_row("SELECT revision FROM local_state", [], |r| r.get(0))
            .map_err(io)?;
        let tx = self.db.unchecked_transaction().map_err(io)?;
        if let Some(replaced) = replaces {
            let deleted=tx.execute("DELETE FROM organization_queue WHERE id=?1 AND entity_id=?2 AND receipt IS NULL AND error IS NOT NULL",params![replaced,action.parts().1]).map_err(io)?;
            if deleted != 1 {
                return Err("outcome_uncertain".into());
            }
            project_organization(&tx)?;
        }
        let effect = organization_effect(&tx, kind, action.parts().1, value["targetId"].as_str())?;
        // Preview is rolled back; the rejected local intent stays durable until the new confirmation commits.
        tx.rollback().map_err(io)?;
        Ok(json!({"localRevision":revision.to_string(),"effect":effect}))
    }
    pub fn organization_browse(
        &self,
        request: super::organization_contract::OrganizationBrowse,
    ) -> Result<Vec<Summary>, String> {
        if request.offset > 10000
            || request.tag_ids.len() > 1000
            || request
                .tag_ids
                .iter()
                .chain(request.collection_id.iter())
                .any(|id| !super::local_contract::uuid4(id))
        {
            return Err("invalid_input".into());
        }
        // Filter identities deliberately do not follow aliases or broaden after deletion.
        let mut statement=self.db.prepare("SELECT id,title,archived FROM visible_prompt WHERE archived=0 AND (?1 IS NULL OR json_extract(record,'$.collectionId')=?1) AND (?1 IS NULL OR EXISTS(SELECT 1 FROM organization_local WHERE id=?1 AND kind='collection')) AND NOT EXISTS(SELECT 1 FROM json_each(?2) wanted WHERE NOT EXISTS(SELECT 1 FROM organization_local WHERE id=wanted.value AND kind='tag') OR NOT EXISTS(SELECT 1 FROM json_each(record,'$.tagIds') present WHERE present.value=wanted.value)) AND (NOT ?3 OR json_extract(record,'$.lastUsedAt') IS NOT NULL OR EXISTS(SELECT 1 FROM pending_usage WHERE prompt_id=visible_prompt.id)) ORDER BY CASE WHEN ?3 THEN max(coalesce((SELECT max(occurred_at) FROM pending_usage WHERE prompt_id=visible_prompt.id),''),coalesce(json_extract(record,'$.lastUsedAt'),'')) END DESC,id LIMIT 50 OFFSET ?4").map_err(io)?;
        let rows = statement
            .query_map(
                params![
                    request.collection_id,
                    json!(request.tag_ids).to_string(),
                    request.recents,
                    request.offset
                ],
                |r| {
                    Ok(Summary {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        archived: r.get(2)?,
                    })
                },
            )
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        Ok(rows)
    }
    pub fn organization_review(&self, id: &str, offset: u32) -> Result<Value, String> {
        if !super::local_contract::uuid4(id) || offset > 10000 {
            return Err("invalid_input".into());
        }
        let result: String = self
            .db
            .query_row(
                "SELECT result FROM organization_receipt WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(io)?;
        let result: Value = serde_json::from_str(&result).map_err(|_| "storage_unavailable")?;
        let mut statement=self.db.prepare("SELECT a.prompt_id,a.archived,p.record FROM organization_affected a LEFT JOIN visible_prompt p ON p.id=a.prompt_id WHERE operation_id=?1 ORDER BY a.prompt_id LIMIT 101 OFFSET ?2").map_err(io)?;
        let rows = statement
            .query_map(params![id, offset], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, bool>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        let next = if rows.len() > 100 {
            Some(offset + 100)
        } else {
            None
        };
        let prompts=rows.into_iter().take(100).map(|(id,archived,current)|Ok(json!({"id":id,"originallyArchived":archived,"current":current.map(|v|serde_json::from_str::<Value>(&v)).transpose().map_err(|_|"storage_unavailable")?}))).collect::<Result<Vec<_>,String>>()?;
        Ok(json!({"operationId":id,"effect":result["effect"],"prompts":prompts,"nextOffset":next}))
    }
}
include!("organization_save.rs");
include!("organization_projection.rs");
include!("organization_upload.rs");

include!("organization_reconcile.rs");
