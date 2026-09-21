use super::library_contract::{Manifest, Organization, Prompt, Records};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangePage {
    pub instance_id: String,
    pub account_id: String,
    pub epoch: String,
    pub version: u32,
    pub normalization: String,
    pub from_revision: String,
    pub revision: String,
    pub head_revision: String,
    pub cursor: String,
    pub has_more: bool,
    pub changes: Vec<Change>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub revision: String,
    pub operation_id: String,
    pub accepted_at: String,
    pub organization: Organization,
    pub prompts: Vec<Prompt>,
    pub deleted_prompt_ids: Vec<String>,
    pub effect: Option<Effect>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Effect {
    pub kind: String,
    pub source_id: String,
    pub source_name: String,
    pub target_id: Option<String>,
    pub target_name: Option<String>,
    pub active_count: u32,
    pub archived_count: u32,
    pub target_active_count: u32,
    pub target_archived_count: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeStatus {
    pub error: Option<String>,
    pub retry_after_ms: u64,
    pub updating: bool,
    pub last_checked_at: Option<String>,
}
pub fn revision(value: &str) -> Result<i64, String> {
    let number = value.parse::<i64>().map_err(|_| "invalid_response")?;
    if number < 0 || number.to_string() != value {
        return Err("invalid_response".into());
    }
    Ok(number)
}
impl ChangePage {
    pub fn validate(&self, manifest: &Manifest) -> Result<(), String> {
        if self.instance_id != manifest.instance_id
            || self.account_id != manifest.account_id
            || self.epoch != manifest.epoch
            || self.version != 1
            || self.normalization != manifest.normalization
            || self.cursor.is_empty()
            || self.cursor.len() > 2048
            || self.changes.len() > 100
        {
            return Err("invalid_response".into());
        }
        let mut next = revision(&self.from_revision)?;
        for event in &self.changes {
            next = next.checked_add(1).ok_or("invalid_response")?;
            if revision(&event.revision)? != next
                || !uuid::Uuid::parse_str(&event.operation_id)
                    .is_ok_and(|id| id.get_version_num() == 4)
                || chrono::DateTime::parse_from_rfc3339(&event.accepted_at).is_err()
                || !event.accepted_at.ends_with('Z')
                || event.prompts.len() > 2
                || event.deleted_prompt_ids.len() > 1
            {
                return Err("invalid_response".into());
            }
            let mut cut = manifest.clone();
            cut.revision = event.revision.clone();
            Records {
                organization: Some(event.organization.clone()),
                prompts: event.prompts.clone(),
            }
            .validate(&cut, 0)?;
            let mut ids = std::collections::HashSet::new();
            for id in event
                .prompts
                .iter()
                .map(|p| &p.id)
                .chain(event.deleted_prompt_ids.iter())
            {
                if !ids.insert(id)
                    || !uuid::Uuid::parse_str(id).is_ok_and(|id| id.get_version_num() == 4)
                {
                    return Err("invalid_response".into());
                }
            }
            if let Some(effect) = &event.effect {
                if !event.prompts.is_empty()
                    || !event.deleted_prompt_ids.is_empty()
                    || !["collection.delete", "tag.delete", "tag.merge"]
                        .contains(&effect.kind.as_str())
                    || !uuid::Uuid::parse_str(&effect.source_id)
                        .is_ok_and(|id| id.get_version_num() == 4)
                    || effect.source_name.is_empty()
                    || effect.source_name.chars().count() > 60
                    || effect.active_count.saturating_add(effect.archived_count) > 10000
                    || effect
                        .target_active_count
                        .saturating_add(effect.target_archived_count)
                        > 10000
                    || (effect.kind == "tag.merge") != effect.target_id.is_some()
                    || effect.target_id.is_some() != effect.target_name.is_some()
                    || effect.target_id.as_ref().is_some_and(|id| {
                        id == &effect.source_id
                            || !uuid::Uuid::parse_str(id).is_ok_and(|v| v.get_version_num() == 4)
                    })
                {
                    return Err("invalid_response".into());
                }
            }
        }
        if next != revision(&self.revision)?
            || next > revision(&self.head_revision)?
            || self.has_more != (next < revision(&self.head_revision)?)
            || (self.has_more && self.changes.is_empty())
        {
            return Err("invalid_response".into());
        }
        Ok(())
    }
}
