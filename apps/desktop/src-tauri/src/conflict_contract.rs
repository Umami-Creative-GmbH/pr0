use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConflictNotice {
    pub id: String,
    pub original_id: String,
    pub copy_id: String,
    pub source_title: String,
    pub created_at: String,
    pub revision: String,
    pub original_deleted: bool,
    #[serde(default)]
    pub original_archived: bool,
    #[serde(default)]
    pub copy_deleted: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewConflict {
    pub instance_id: String,
    pub account_id: String,
    pub generation: u64,
    pub notice_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConflictPage {
    pub instance_id: String,
    pub account_id: String,
    pub notices: Vec<ConflictNotice>,
    pub revision: String,
    pub next_cursor: Option<String>,
}
impl ConflictNotice {
    pub fn validate(&self) -> Result<(), String> {
        if [&self.id, &self.original_id, &self.copy_id]
            .iter()
            .any(|id| !super::local_contract::uuid4(id))
            || self.original_id == self.copy_id
            || self.source_title.chars().count() > 200
            || chrono::DateTime::parse_from_rfc3339(&self.created_at).is_err()
        {
            return Err("invalid_response".into());
        }
        super::change_contract::revision(&self.revision)?;
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdjustmentNotice {
    pub id: String,
    pub prompt_id: String,
    pub message: String,
    pub created_at: String,
    pub revision: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdjustmentPage {
    pub instance_id: String,
    pub account_id: String,
    pub notices: Vec<AdjustmentNotice>,
    pub revision: String,
    pub next_cursor: Option<String>,
}
