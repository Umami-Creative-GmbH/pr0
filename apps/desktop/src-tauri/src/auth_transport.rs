use serde_json::Value;
use std::io::Read;
use std::time::Duration;

#[derive(Clone, Copy)]
pub enum Endpoint {
    Capabilities,
    Code,
    Token,
    Cancel,
    Session,
    SignOut,
    Snapshot,
    SnapshotPage,
    Mutations,
    Receipts,
    Changes,
    DeletionLookup,
    DeletionVerification,
}
impl Endpoint {
    fn path(self) -> &'static str {
        match self {
            Self::Capabilities => "/api/v1/capabilities",
            Self::Code => "/api/auth/device/code",
            Self::Token => "/api/auth/device/token",
            Self::Cancel => "/api/auth/device/cancel",
            Self::Session => "/api/v1/desktop/session",
            Self::SignOut => "/api/v1/desktop/sign-out",
            Self::Snapshot => "/api/v1/sync/snapshots",
            Self::SnapshotPage => "/api/v1/sync/snapshots/page",
            Self::Mutations => "/api/v1/sync/mutations",
            Self::Receipts => "/api/v1/sync/receipts",
            Self::Changes => "/api/v1/sync/changes",
            Self::DeletionLookup => "/api/v1/account-deletions/",
            Self::DeletionVerification => "/api/v1/account-deletions/verification",
        }
    }
}
pub trait Transport: Send + Sync {
    fn changes(
        &self,
        origin: &str,
        token: &str,
        body: Value,
        _cancelled: &(dyn Fn() -> bool + Sync),
    ) -> Result<Value, String> {
        self.request(origin, Endpoint::Changes, Some(token), Some(body))
    }
    fn request(
        &self,
        origin: &str,
        endpoint: Endpoint,
        token: Option<&str>,
        body: Option<Value>,
    ) -> Result<Value, String>;
    fn open_browser(&self, url: &str) -> Result<(), String>;
}
pub struct HttpsTransport {
    client: reqwest::blocking::Client,
    changes_client: reqwest::Client,
}
impl HttpsTransport {
    #[cfg(test)]
    pub fn with_test_root(pem: &[u8]) -> Result<Self, String> {
        let root = reqwest::Certificate::from_pem(pem).map_err(|_| "invalid_test_root")?;
        Ok(Self {
            changes_client: reqwest::Client::builder()
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(35))
                .add_root_certificate(root.clone())
                .build()
                .map_err(|_| "network_unavailable")?,
            client: reqwest::blocking::Client::builder()
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(20))
                .add_root_certificate(root)
                .build()
                .map_err(|_| "network_unavailable")?,
        })
    }
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            changes_client: reqwest::Client::builder()
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(35))
                .build()
                .map_err(|_| "network_unavailable")?,
            client: reqwest::blocking::Client::builder()
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(20))
                .build()
                .map_err(|_| "network_unavailable")?,
        })
    }
}
impl Transport for HttpsTransport {
    fn changes(
        &self,
        origin: &str,
        token: &str,
        body: Value,
        cancelled: &(dyn Fn() -> bool + Sync),
    ) -> Result<Value, String> {
        tauri::async_runtime::block_on(async {
            let request = async {
                let mut response = self
                    .changes_client
                    .get(format!("{origin}{}", Endpoint::Changes.path()))
                    .bearer_auth(token)
                    .query(&body)
                    .send()
                    .await
                    .map_err(|_| "network_unavailable")?;
                let status = response.status().as_u16();
                if status == 429 || status == 503 {
                    let delay = response
                        .headers()
                        .get("retry-after")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(30)
                        .clamp(1, 86400);
                    return Err(format!("retry_after:{delay}"));
                }
                if status == 403 {
                    let mut bytes = Vec::new();
                    while let Some(chunk) =
                        response.chunk().await.map_err(|_| "network_unavailable")?
                    {
                        if bytes.len() + chunk.len() > 4096 {
                            return Err("authentication_required".into());
                        }
                        bytes.extend_from_slice(&chunk);
                    }
                    return Err(authorization_failure(&bytes));
                }
                if status == 401 {
                    return Err("authentication_required".into());
                }
                if status == 409 {
                    return Err("snapshot_required".into());
                }
                if !response.status().is_success() {
                    return Err("request_failed".into());
                }
                const LIMIT: usize = 4_194_304;
                if response.content_length().is_some_and(|v| v > LIMIT as u64) {
                    return Err("invalid_response".into());
                }
                let mut bytes = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(|_| "network_unavailable")? {
                    if bytes.len() + chunk.len() > LIMIT {
                        return Err("invalid_response".into());
                    }
                    bytes.extend_from_slice(&chunk);
                }
                serde_json::from_slice(&bytes).map_err(|_| "invalid_response".into())
            };
            let mut request = std::pin::pin!(request);
            loop {
                if cancelled() {
                    return Err("operation_cancelled".into());
                }
                if let Ok(result) =
                    tokio::time::timeout(Duration::from_millis(100), &mut request).await
                {
                    return result;
                }
            }
        })
    }
    fn request(
        &self,
        origin: &str,
        endpoint: Endpoint,
        token: Option<&str>,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let mut url = format!("{}{}", origin, endpoint.path());
        let mut request = if matches!(endpoint, Endpoint::DeletionLookup) {
            let handle = body
                .as_ref()
                .and_then(|b| b.get("handle"))
                .and_then(Value::as_str)
                .ok_or("invalid_request")?;
            if !super::auth_contract::base64_key(handle) || token.is_some() {
                return Err("invalid_request".into());
            }
            url.push_str(handle);
            self.client.get(url)
        } else if matches!(endpoint, Endpoint::DeletionVerification) {
            self.client.get(url).query(&body.unwrap_or_default())
        } else if matches!(endpoint, Endpoint::Changes) {
            self.client
                .get(url)
                .query(&body.unwrap_or_default())
                .timeout(Duration::from_secs(35))
        } else if let Some(body) = body {
            self.client.post(url).json(&body)
        } else {
            self.client.get(url)
        };
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        let result = request.send().map_err(|_| "network_unavailable")?;
        let status = result.status();
        if status.as_u16() == 429 || status.as_u16() == 503 {
            let delay = result
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(30);
            return Err(format!("retry_after:{}", delay.clamp(1, 86400)));
        }
        if status.is_redirection() {
            return Err("redirect_rejected".into());
        }
        if status.as_u16() == 403 {
            let mut bytes = Vec::new();
            result
                .take(4097)
                .read_to_end(&mut bytes)
                .map_err(|_| "network_unavailable")?;
            return Err(authorization_failure(&bytes));
        }
        if status.as_u16() == 401 {
            return Err("authentication_required".into());
        }
        if matches!(endpoint, Endpoint::Changes) && status.as_u16() == 409 {
            return Err("snapshot_required".into());
        }
        if matches!(endpoint, Endpoint::SnapshotPage)
            && (status.as_u16() == 410 || status.as_u16() == 404)
        {
            return Err("snapshot_expired".into());
        }
        let limit = match endpoint {
            Endpoint::Snapshot => 262144,
            Endpoint::SnapshotPage => super::library_contract::PAGE_BYTES,
            Endpoint::DeletionVerification => super::deletion_proof::VERIFICATION_PAGE_BYTES,
            Endpoint::Mutations | Endpoint::Receipts | Endpoint::Changes => 4_194_304,
            _ => 16384,
        };
        if result
            .content_length()
            .is_some_and(|length| length > limit as u64)
        {
            return Err("invalid_response".into());
        }
        let mut bytes = Vec::new();
        result
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "network_unavailable")?;
        if bytes.len() > limit {
            return Err("invalid_response".into());
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| "invalid_response")?;
        if !status.is_success()
            && (!matches!(endpoint, Endpoint::Token) || value.get("error").is_none())
        {
            return Err("request_failed".into());
        }
        Ok(value)
    }
    fn open_browser(&self, url: &str) -> Result<(), String> {
        open::that(url).map_err(|_| "browser_unavailable".into())
    }
}

fn authorization_failure(bytes: &[u8]) -> String {
    if bytes.len() <= 4096
        && serde_json::from_slice::<Value>(bytes)
            .ok()
            .and_then(|value| value.get("code").and_then(Value::as_str).map(str::to_owned))
            .as_deref()
            == Some("account_suspended")
    {
        "account_suspended".into()
    } else {
        "authentication_required".into()
    }
}

pub fn canonical_origin(input: &str) -> Result<String, String> {
    if input.len() > 2048 {
        return Err("invalid_instance".into());
    }
    let url = url::Url::parse(input).map_err(|_| "invalid_instance")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("invalid_instance".into());
    }
    Ok(url.origin().ascii_serialization())
}
