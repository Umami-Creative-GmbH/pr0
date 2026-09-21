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
        }
    }
}
pub trait Transport: Send + Sync {
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
}
impl HttpsTransport {
    #[cfg(test)]
    pub fn with_test_root(pem: &[u8]) -> Result<Self, String> {
        let root = reqwest::Certificate::from_pem(pem).map_err(|_| "invalid_test_root")?;
        Ok(Self {
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
    fn request(
        &self,
        origin: &str,
        endpoint: Endpoint,
        token: Option<&str>,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let url = format!("{}{}", origin, endpoint.path());
        let mut request = if matches!(endpoint, Endpoint::Changes) {
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
        if status.as_u16() == 401 || status.as_u16() == 403 {
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
