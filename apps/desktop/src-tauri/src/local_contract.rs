use super::library_contract::Prompt;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptText {
    pub title: String,
    pub description: String,
    pub content: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRequest {
    pub instance_id: String,
    pub account_id: String,
    pub generation: u64,
    pub operation_id: String,
    pub prompt_id: String,
    pub expected_local_revision: Option<String>,
    pub desired: PromptText,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPrompt {
    pub prompt: Prompt,
    pub local_revision: String,
    pub pending: bool,
}
#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingChange {
    pub payload: serde_json::Value,
    pub state: String,
    pub local_revision: String,
}
pub fn uuid4(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .is_ok_and(|id| id.get_version_num() == 4 && id.hyphenated().to_string() == value)
}
impl PromptText {
    pub fn validate(mut self) -> Result<Self, String> {
        // Rust's White_Space property agrees with the contract's pinned set (not BOM).
        if [&self.title, &self.description, &self.content]
            .iter()
            .any(|s| s.contains('\0'))
        {
            return Err("validation_unicode".into());
        }
        self.title = self.title.trim().into();
        self.description = self.description.trim().into();
        if self.title.is_empty() || self.title.chars().count() > 200 {
            return Err("validation_title".into());
        }
        if self.description.chars().count() > 2000 {
            return Err("validation_description".into());
        }
        if self.content.trim().is_empty() || self.content.len() > 262_144 {
            return Err("validation_content".into());
        }
        Ok(self)
    }
    pub fn from_prompt(prompt: &Prompt) -> Self {
        Self {
            title: prompt.title.clone(),
            description: prompt.description.clone(),
            content: prompt.content.clone(),
        }
    }
}
