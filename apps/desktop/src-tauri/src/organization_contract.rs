use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizationMetadata {
    pub instance_id: String,
    pub account_id: String,
    pub revision: String,
    pub states: Vec<OrganizationState>,
    pub removals: Vec<MembershipRemoval>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizationState {
    pub id: String,
    pub entity: String,
    pub name: String,
    pub state: String,
    pub target_id: Option<String>,
    #[serde(rename = "targetName")]
    pub _target_name: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MembershipRemoval {
    pub prompt_id: String,
    pub tag_id: String,
    pub revision: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizeRequest {
    pub instance_id: String,
    pub account_id: String,
    pub generation: u64,
    pub operation_id: String,
    pub replaces: Option<String>,
    pub expected_local_revision: Option<String>,
    pub action: OrganizationAction,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizationBrowse {
    pub collection_id: Option<String>,
    pub tag_ids: Vec<String>,
    pub offset: u32,
    pub recents: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum OrganizationAction {
    #[serde(rename = "collection.create")]
    CreateCollection { id: String, name: String },
    #[serde(rename = "tag.create")]
    CreateTag { id: String, name: String },
    #[serde(rename = "collection.rename")]
    RenameCollection { id: String, name: String },
    #[serde(rename = "tag.rename")]
    RenameTag { id: String, name: String },
    #[serde(rename = "collection.delete")]
    DeleteCollection { id: String },
    #[serde(rename = "tag.delete")]
    DeleteTag { id: String },
    #[serde(rename = "tag.merge")]
    MergeTag {
        id: String,
        #[serde(rename = "targetId")]
        target_id: String,
    },
    #[serde(rename = "prompt.collection")]
    AssignCollection {
        id: String,
        #[serde(rename = "collectionId")]
        collection_id: Option<String>,
    },
    #[serde(rename = "prompt.tags")]
    AssignTags {
        id: String,
        add: Vec<String>,
        remove: Vec<String>,
    },
}

impl OrganizationAction {
    pub fn parts(&self) -> (&str, &str, Option<&str>) {
        match self {
            Self::CreateCollection { id, name } | Self::RenameCollection { id, name } => {
                ("collection", id, Some(name))
            }
            Self::CreateTag { id, name } | Self::RenameTag { id, name } => ("tag", id, Some(name)),
            Self::DeleteCollection { id } => ("collection", id, None),
            Self::DeleteTag { id } | Self::MergeTag { id, .. } => ("tag", id, None),
            Self::AssignCollection { id, .. } | Self::AssignTags { id, .. } => ("prompt", id, None),
        }
    }
}
