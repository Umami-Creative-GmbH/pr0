// Snapshot replacement cannot infer an alias or an observed removal from absence.
// Reconcile only identities this device knows, in bounded authenticated reads.
impl LibraryStore {
    pub fn organization_reconcile_requests(&self) -> Result<Vec<Value>, String> {
        if !self.status()?.complete {
            return Ok(vec![]);
        }
        let revision = organization_base_revision(&self.db)?;
        let checked: Option<String> = self
            .db
            .query_row("SELECT revision FROM organization_checkpoint", [], |r| {
                r.get(0)
            })
            .map_err(io)?;
        if checked.as_ref() == Some(&revision) {
            return Ok(vec![]);
        }
        let mut requests = vec![];
        let mut statement=self.db.prepare("SELECT id FROM organization_known WHERE id NOT IN(SELECT id FROM organization WHERE snapshot=(SELECT active FROM state)) ORDER BY id").map_err(io)?;
        let ids = statement
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        for chunk in ids.chunks(100) {
            requests.push(json!({"ids":chunk.join(",")}));
        }
        let operations=organization_rows(&self.db,"SELECT payload FROM organization_queue WHERE json_extract(payload,'$.kind')='prompt.tags' AND receipt IS NULL")?;
        let mut seen = std::collections::HashSet::new();
        for operation in operations {
            let prompt = operation["promptId"]
                .as_str()
                .ok_or("storage_unavailable")?;
            let ids = operation["add"]
                .as_array()
                .ok_or("storage_unavailable")?
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>();
            if !ids.is_empty() {
                let request = json!({"ids":ids.join(","),"promptIds":prompt});
                if seen.insert(request.to_string()) {
                    requests.push(request);
                }
            }
        }
        Ok(requests)
    }
    pub fn reconcile_organization(
        &mut self,
        revision: &str,
        responses: Vec<super::organization_contract::OrganizationMetadata>,
    ) -> Result<(), String> {
        let tx = self.db.transaction().map_err(io)?;
        if organization_base_revision(&tx)? != revision {
            return Err("results_changed".into());
        }
        for response in responses {
            if response.instance_id != self.instance
                || response.account_id != self.account
                || response.revision != revision
                || response.states.len() > 1000
                || response.removals.len() > 2000
            {
                return Err("results_changed".into());
            }
            for state in response.states {
                if !super::local_contract::uuid4(&state.id)
                    || !matches!(state.entity.as_str(), "collection" | "tag")
                    || !matches!(state.state.as_str(), "deleted" | "merged")
                    || state.name.is_empty()
                    || state.name.chars().count() > 60
                    || state
                        .target_id
                        .as_ref()
                        .is_some_and(|v| !super::local_contract::uuid4(v))
                {
                    return Err("invalid_response".into());
                }
                tx.execute(
                    "INSERT OR REPLACE INTO organization_removed VALUES(?1,?2,?3,?4,?5,0)",
                    params![
                        state.id,
                        state.entity,
                        state.name,
                        state.target_id,
                        revision
                    ],
                )
                .map_err(io)?;
            }
            for removal in response.removals {
                let removed = super::change_contract::revision(&removal.revision)?;
                if !super::local_contract::uuid4(&removal.prompt_id)
                    || !super::local_contract::uuid4(&removal.tag_id)
                    || removed > super::change_contract::revision(revision)?
                {
                    return Err("invalid_response".into());
                }
                tx.execute("INSERT INTO organization_membership_removal VALUES(?1,?2,?3) ON CONFLICT(prompt_id,tag_id) DO UPDATE SET revision=max(revision,excluded.revision)",params![removal.prompt_id,removal.tag_id,removed]).map_err(io)?;
            }
        }
        tx.execute("UPDATE organization_checkpoint SET revision=?1", [revision])
            .map_err(io)?;
        tx.execute("UPDATE local_state SET revision=revision+1", [])
            .map_err(io)?;
        project_organization(&tx)?;
        commit_search(tx)
    }
}
