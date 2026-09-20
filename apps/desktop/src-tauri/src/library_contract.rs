use super::auth_contract::valid_id;
use serde::{Deserialize, Serialize};

pub const PAGE_BYTES: usize = 4_194_304;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub instance_id: String,
    pub account_id: String,
    pub id: String,
    pub epoch: String,
    pub version: u32,
    pub normalization: String,
    pub revision: String,
    pub expires_at: String,
    pub prompt_count: u32,
    pub pages: Vec<PageDigest>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PageDigest {
    pub digest: String,
    pub bytes: usize,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    pub id: String,
    pub page: usize,
    pub payload: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Records {
    pub organization: Option<Organization>,
    pub prompts: Vec<Prompt>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Organization {
    pub instance_id: String,
    pub account_id: String,
    pub revision: String,
    pub text_bytes: u64,
    pub collections: Vec<OrganizationEntry>,
    pub tags: Vec<OrganizationEntry>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizationEntry {
    pub id: String,
    pub name: String,
    pub revision: String,
    pub active_count: u32,
    pub archived_count: u32,
    pub total_count: u32,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Prompt {
    pub instance_id: String,
    pub account_id: String,
    pub id: String,
    pub title: String,
    pub description: String,
    pub content: String,
    pub revision: String,
    pub created_at: String,
    pub modified_at: String,
    pub favorite: bool,
    pub archived: bool,
    pub collection_id: Option<String>,
    pub tag_ids: Vec<String>,
    pub use_count: u64,
    pub last_used_at: Option<String>,
    pub source_title: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub archived: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatus {
    pub text_bytes: u64,
    pub pending_changes: u32,
    pub complete: bool,
    pub downloaded: u32,
    pub total: u32,
    pub applied_pages: u32,
    pub total_pages: u32,
    pub revision: Option<String>,
    pub account_id: String,
    pub instance_id: String,
}
fn revision(value: &str) -> Option<u64> {
    let parsed = value.parse::<u64>().ok()?;
    (parsed <= i64::MAX as u64 && parsed.to_string() == value).then_some(parsed)
}
fn at_cut(value: &str, cut: &str) -> bool {
    revision(value)
        .zip(revision(cut))
        .is_some_and(|(v, c)| v <= c)
}
fn uuid4(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .is_ok_and(|v| v.get_version_num() == 4 && v.hyphenated().to_string() == value)
}
fn text(value: &str, max: usize, required: bool) -> bool {
    !value.contains('\0') && value.chars().count() <= max && (!required || !value.trim().is_empty())
}
fn date(value: &str) -> bool {
    value.len() <= 32 && value.ends_with('Z') && chrono::DateTime::parse_from_rfc3339(value).is_ok()
}
impl Manifest {
    pub fn expired(&self) -> bool {
        chrono::DateTime::parse_from_rfc3339(&self.expires_at).map_or(true, |d| {
            d <= chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
        })
    }
    pub fn validate(&self, instance: &str, account: &str) -> Result<(), String> {
        if self.instance_id != instance
            || self.account_id != account
            || !uuid4(&self.id)
            || !valid_id(&self.epoch)
            || self.version != 1
            || self.normalization != "pr0-search-v1-ucd17"
            || revision(&self.revision).is_none()
            || !date(&self.expires_at)
            || self.prompt_count > 10000
            || self.pages.is_empty()
            || self.pages.len() > 1024
            || self.pages.iter().any(|p| {
                p.bytes == 0
                    || p.bytes > PAGE_BYTES
                    || p.digest.len() != 64
                    || !p
                        .digest
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
        {
            return Err("invalid_response".into());
        }
        Ok(())
    }
}
impl Records {
    pub fn validate(&self, manifest: &Manifest, page: usize) -> Result<(), String> {
        if (page == 0) != self.organization.is_some() || self.prompts.len() > 10000 {
            return Err("invalid_response".into());
        }
        if let Some(org) = &self.organization {
            if org.instance_id != manifest.instance_id
                || org.account_id != manifest.account_id
                || org.revision != manifest.revision
                || org.text_bytes > 104857600
                || org.collections.len() > 200
                || org.tags.len() > 1000
            {
                return Err("invalid_response".into());
            }
            for entries in [&org.collections, &org.tags] {
                let mut ids = std::collections::HashSet::new();
                for entry in entries {
                    if !uuid4(&entry.id)
                        || !ids.insert(&entry.id)
                        || !text(&entry.name, 60, true)
                        || !at_cut(&entry.revision, &manifest.revision)
                        || entry.total_count > 10000
                        || entry.active_count.checked_add(entry.archived_count)
                            != Some(entry.total_count)
                    {
                        return Err("invalid_response".into());
                    }
                }
            }
        }
        for p in &self.prompts {
            if p.instance_id != manifest.instance_id
                || p.account_id != manifest.account_id
                || !uuid4(&p.id)
                || !text(&p.title, 200, true)
                || !text(&p.description, 2000, false)
                || !text(&p.content, 262144, true)
                || p.content.len() > 262144
                || !at_cut(&p.revision, &manifest.revision)
                || !date(&p.created_at)
                || !date(&p.modified_at)
                || p.last_used_at.as_ref().is_some_and(|d| !date(d))
                || p.source_title.as_ref().is_some_and(|s| !text(s, 200, true))
                || p.collection_id.as_ref().is_some_and(|id| !uuid4(id))
                || p.tag_ids.len() > 20
                || p.tag_ids.iter().any(|id| !uuid4(id))
                || p.tag_ids.windows(2).any(|pair| pair[0] >= pair[1])
            {
                return Err("invalid_response".into());
            }
        }
        Ok(())
    }
}
