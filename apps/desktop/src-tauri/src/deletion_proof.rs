use super::auth_contract::{base64_key, valid_id, DeletionKey, Retained};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const INVALID: &str = "invalid_deletion_evidence";
pub const VERIFICATION_PAGE_SIZE: usize = 64;
pub const VERIFICATION_PAGE_BYTES: usize = 270_336;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Proof {
    pub receipt: String,
    pub rotations: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Verification {
    pub instance_id: String,
    pub anchor: DeletionKey,
    pub rotations: Vec<String>,
    pub next_page: Option<u64>,
}
#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum Lookup {
    Deleted { receipt: String },
    Absent,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    alg: String,
    typ: String,
    kid: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Rotation {
    version: u32,
    instance_id: String,
    old_kid: String,
    new_kid: String,
    key: DeletionKey,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Claims {
    version: u32,
    instance_id: String,
    account_id: String,
    handle: String,
    deletion_id: String,
    deleted_at: String,
}
fn public_key(key: &DeletionKey) -> Result<Vec<u8>, String> {
    if key.kty != "OKP" || key.crv != "Ed25519" || !valid_id(&key.kid) {
        return Err(INVALID.into());
    }
    let bytes = URL_SAFE_NO_PAD.decode(&key.x).map_err(|_| INVALID)?;
    if bytes.len() != 32 {
        return Err(INVALID.into());
    }
    Ok(bytes)
}
fn verified<T: serde::de::DeserializeOwned>(
    compact: &str,
    typ: &str,
    keys: &HashMap<String, DeletionKey>,
) -> Result<(String, T), String> {
    if compact.len() > 4096 {
        return Err(INVALID.into());
    }
    let parts: Vec<_> = compact.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|p| p.is_empty()) {
        return Err(INVALID.into());
    }
    let header: Header =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[0]).map_err(|_| INVALID)?)
            .map_err(|_| INVALID)?;
    if header.alg != "Ed25519" || header.typ != typ {
        return Err(INVALID.into());
    }
    let key = public_key(keys.get(&header.kid).ok_or(INVALID)?)?;
    let signature = URL_SAFE_NO_PAD.decode(parts[2]).map_err(|_| INVALID)?;
    let input_length = parts[0].len() + 1 + parts[1].len();
    UnparsedPublicKey::new(&ED25519, key)
        .verify(&compact.as_bytes()[..input_length], &signature)
        .map_err(|_| INVALID)?;
    // Interpret claims only after verification of the exact transmitted signing input.
    let payload = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).map_err(|_| INVALID)?)
        .map_err(|_| INVALID)?;
    Ok((header.kid, payload))
}
pub struct KeyChain {
    keys: HashMap<String, DeletionKey>,
    previous: String,
}
impl KeyChain {
    pub fn new(retained: &Retained) -> Result<Self, String> {
        let anchor = &retained.trust.deletion_key;
        public_key(anchor)?;
        Ok(Self {
            keys: HashMap::from([(anchor.kid.clone(), anchor.clone())]),
            previous: anchor.kid.clone(),
        })
    }
    pub fn extend(&mut self, statements: &[String], retained: &Retained) -> Result<(), String> {
        for statement in statements {
            let (kid, rotation): (_, Rotation) =
                verified(statement, "pr0-deletion-key-rotation+jws", &self.keys)?;
            if rotation.version != 1
                || rotation.instance_id != retained.trust.instance_id
                || rotation.old_kid != self.previous
                || kid != self.previous
                || rotation.new_kid != rotation.key.kid
                || self.keys.contains_key(&rotation.new_kid)
            {
                return Err(INVALID.into());
            }
            public_key(&rotation.key)?;
            self.previous = rotation.new_kid.clone();
            self.keys.insert(rotation.new_kid, rotation.key);
        }
        Ok(())
    }
    pub fn verify_receipt(&self, receipt: &str, retained: &Retained) -> Result<(), String> {
        let (_, claims): (_, Claims) = verified(receipt, "pr0-account-deletion+jws", &self.keys)?;
        if claims.version != 1
            || claims.instance_id != retained.identity.instance.id
            || claims.account_id != retained.identity.account.id
            || claims.handle != retained.identity.deletion_handle
            || !base64_key(&claims.handle)
            || !valid_id(&claims.deletion_id)
            || !claims.deleted_at.ends_with('Z')
            || chrono::DateTime::parse_from_rfc3339(&claims.deleted_at).is_err()
        {
            return Err(INVALID.into());
        }
        // Irreversible deletion deliberately has no expiration or freshness check.
        Ok(())
    }
}
pub fn verify(proof: &Proof, retained: &Retained) -> Result<(), String> {
    let mut chain = KeyChain::new(retained)?;
    chain.extend(&proof.rotations, retained)?;
    chain.verify_receipt(&proof.receipt, retained)
}
