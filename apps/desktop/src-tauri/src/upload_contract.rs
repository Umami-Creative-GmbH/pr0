use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub operation_id: String,
    pub prompt_id: String,
    pub revision: String,
    pub accepted_at: String,
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
    pub retry_after: Option<u64>,
    pub fields: Option<serde_json::Value>,
    pub resource: Option<String>,
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
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadStatus {
    pub last_checked_at: Option<String>,
    pub waiting: u32,
    pub awaiting_download: u32,
    pub error: Option<String>,
    pub retry_after_ms: u64,
    pub errors: Vec<PendingError>,
    pub mappings: Vec<Mapping>,
}
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
