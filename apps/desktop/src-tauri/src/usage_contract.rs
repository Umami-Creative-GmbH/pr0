use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CopyRequest {
    pub instance_id: String,
    pub account_id: String,
    pub generation: u64,
    pub prompt_id: String,
    #[serde(default, skip_serializing)]
    pub template: Option<String>,
    #[serde(default, skip_serializing)]
    pub values: Vec<(String, String)>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub origin: CopyRequest,
    pub usage_saved: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStatus {
    pub waiting: u32,
    pub awaiting_download: u32,
    pub memory_only: usize,
    pub error: Option<String>,
    pub retry_after_ms: u64,
}
#[derive(Clone)]
pub struct Usage {
    pub id: String,
    pub prompt_id: String,
    pub occurred_at: String,
}
#[cfg(test)]
thread_local! { pub static TEST_TIME: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) }; }
pub fn occurrence_time() -> String {
    #[cfg(test)]
    if let Some(time) = TEST_TIME.with(|value| value.borrow().clone()) {
        return time;
    }
    chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
