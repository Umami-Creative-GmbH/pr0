use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LifecycleRequest {
    pub instance_id: String,
    pub account_id: String,
    pub generation: u64,
    pub operation_id: String,
    pub prompt_id: String,
    pub expected_local_revision: String,
    pub action: LifecycleAction,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum LifecycleAction {
    Favorite {
        value: bool,
    },
    Archive {
        value: bool,
    },
    Duplicate {
        #[serde(rename = "copyId")]
        copy_id: String,
    },
    Delete {
        confirmed: bool,
    },
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleResult {
    pub prompt_id: String,
    pub local_revision: String,
}

// Saved alongside the full text variant; wire() places these typed fields in
// the shared REST operation's base/desired objects.
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "field", rename_all = "camelCase")]
pub enum PendingMetadata {
    Favorite { base: bool, desired: bool },
    Archived { base: bool, desired: bool },
}
impl PendingMetadata {
    pub fn apply(&self, prompt: &mut super::library_contract::Prompt) {
        match self {
            Self::Favorite { desired, .. } => prompt.favorite = *desired,
            Self::Archived { desired, .. } => prompt.archived = *desired,
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryRequest {
    pub instance_id: String,
    pub account_id: String,
    pub generation: u64,
    pub prompt_id: String,
    pub action: RecoveryAction,
    pub confirmed: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    Retry,
    Discard,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LibraryView {
    All,
    Favorites,
    Archive,
}
