use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub operation_id: String,
    pub prompt_id: String,
    pub revision: String,
    pub accepted_at: String,
    pub used_at: Option<String>,
    pub conflict: Option<Conflict>,
    pub organization_notice: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Conflict {
    pub copy_id: String,
    pub notice_id: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Failure {
    pub operation_id: String,
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<serde_json::Value>,
}
#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Outcome {
    Accepted(Receipt),
    Rejected {
        error: Failure,
    },
    Unknown {
        #[serde(rename = "operationId")]
        operation_id: String,
    },
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub results: Vec<Outcome>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mapping {
    pub original_id: String,
    pub copy_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingError {
    pub prompt_id: String,
    pub code: String,
    pub failure: Option<serde_json::Value>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPrompt {
    pub prompt_id: String,
    pub title: String,
    pub deleting: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadStatus {
    pub attention_error: Option<String>,
    pub last_checked_at: Option<String>,
    pub waiting: u32,
    pub awaiting_download: u32,
    pub error: Option<String>,
    pub retry_after_ms: u64,
    pub errors: Vec<PendingError>,
    pub mappings: Vec<Mapping>,
    pub pending: Vec<PendingPrompt>,
}
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
