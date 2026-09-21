use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SignOutChoice {
    Cancel,
    Synchronize,
    Discard,
    RetryCleanup,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignOutRequest {
    pub instance_id: String,
    pub account_id: String,
    pub generation: u64,
    pub choice: SignOutChoice,
    pub discard_confirmed: bool,
}
impl SignOutRequest {
    pub fn validate(&self) -> Result<(), String> {
        if !valid_id(&self.instance_id)
            || !valid_id(&self.account_id)
            || self.generation > 9_007_199_254_740_991
        {
            return Err("invalid_transition".into());
        }
        if self.choice == SignOutChoice::Discard && !self.discard_confirmed {
            return Err("discard_confirmation_required".into());
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeletionKey {
    pub kid: String,
    pub kty: String,
    pub crv: String,
    pub x: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub credential_bytes: u32,
    pub response_bytes: u32,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capabilities {
    pub instance_id: String,
    pub origin: String,
    pub protocols: Vec<u32>,
    pub normalization: String,
    pub device_authorization: bool,
    pub deletion_key: DeletionKey,
    pub limits: Limits,
    // Negotiation is fresh network evidence, not persisted session metadata.
    #[serde(default, skip_serializing)]
    pub compatibility: Option<Compatibility>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Compatibility {
    pub support_days: u32,
    pub contracts: Vec<SyncContract>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SyncContract {
    pub protocol: u32,
    pub normalization: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Instance {
    pub id: String,
    pub origin: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub verified: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Session {
    pub id: String,
    pub expires_at: String,
    pub provenance: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub instance: Instance,
    pub account: Account,
    pub session: Session,
    pub deletion_handle: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Token {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: u64,
    pub scope: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Success {
    pub success: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Retained {
    pub version: u32,
    pub identity: Identity,
    pub trust: Capabilities,
    pub cleanup_pending: bool,
    #[serde(default)]
    pub authentication_required: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub version: u32,
    pub origin: String,
    pub instance_id: String,
    pub account_id: String,
    pub session_id: String,
    pub token: String,
}

pub fn valid_id(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .is_ok_and(|id| id.get_variant() == uuid::Variant::RFC4122 && id.get_version().is_some())
}
pub fn base64_key(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
pub fn valid_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._~-".contains(&b))
}
impl Capabilities {
    pub fn validate(&self, origin: &str) -> Result<(), String> {
        if self.origin != origin
            || !valid_id(&self.instance_id)
            || self.protocols.is_empty()
            || self.protocols.len() > 16
            || self
                .protocols
                .iter()
                .any(|version| *version == 0 || *version > 65535)
            || self.normalization.is_empty()
            || self.normalization.len() > 80
            || !self.device_authorization
            || self.deletion_key.kty != "OKP"
            || self.deletion_key.crv != "Ed25519"
            || !valid_id(&self.deletion_key.kid)
            || !base64_key(&self.deletion_key.x)
            || self.limits.credential_bytes != 2560
            || self.limits.response_bytes != 16384
        {
            return Err("incompatible_instance".into());
        }
        Ok(())
    }
    pub fn negotiate(&self) -> Result<(), String> {
        let compatible = if let Some(policy) = &self.compatibility {
            policy.support_days == 90
                && !policy.contracts.is_empty()
                && policy.contracts.len() <= 16
                && policy.contracts.iter().all(|entry| {
                    entry.protocol > 0
                        && entry.protocol <= 65535
                        && !entry.normalization.is_empty()
                        && entry.normalization.len() <= 80
                })
                && policy.contracts.iter().any(|entry| {
                    entry.protocol == 1 && entry.normalization == "pr0-search-v1-ucd17"
                })
        } else {
            self.protocols.contains(&1) && self.normalization == "pr0-search-v1-ucd17"
        };
        if !compatible {
            return Err("compatibility_update_required".into());
        }
        Ok(())
    }
}
impl Identity {
    pub fn expired(&self) -> bool {
        chrono::DateTime::parse_from_rfc3339(&self.session.expires_at).map_or(true, |expiry| {
            expiry <= chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
        })
    }
    pub fn validate(&self, trust: &Capabilities) -> Result<(), String> {
        if self.instance.id != trust.instance_id
            || self.instance.origin != trust.origin
            || !valid_id(&self.account.id)
            || !valid_id(&self.session.id)
            || !self.account.verified
            || self.session.provenance != "device"
            || !base64_key(&self.deletion_handle)
            || self.account.email.len() > 254
            || !self.account.email.contains('@')
            || self.session.expires_at.len() > 32
            || !self.session.expires_at.ends_with('Z')
            || chrono::DateTime::parse_from_rfc3339(&self.session.expires_at).is_err()
        {
            return Err("invalid_response".into());
        }
        Ok(())
    }
}
