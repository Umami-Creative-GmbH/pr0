use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequest {
    pub instance_id: String,
    pub account_id: String,
    pub generation: u64,
    pub request_id: String,
    pub query: String,
    pub view: String,
    pub sort: String,
    pub tag_ids: Vec<String>,
    pub collection_id: Option<String>,
    pub view_collection_id: Option<String>,
    pub favorite: Option<bool>,
    pub cursor: Option<String>,
    pub selected_id: Option<String>,
    pub limit: usize,
}
impl SearchRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.query.chars().count() > 200
            || self.query.contains('\0')
            || !super::auth_contract::valid_id(&self.request_id)
            || !(1..=100).contains(&self.limit)
            || self.tag_ids.len() > 1000
            || !["all", "favorites", "archive", "collection", "recents"]
                .contains(&self.view.as_str())
            || ![
                "relevance",
                "recently-used",
                "recently-modified",
                "newest",
                "oldest",
                "title",
            ]
            .contains(&self.sort.as_str())
            || ((self.view == "collection") != self.view_collection_id.is_some())
            || self.cursor.as_ref().is_some_and(|c| c.len() > 2048)
            || self
                .tag_ids
                .iter()
                .chain(self.collection_id.iter())
                .chain(self.view_collection_id.iter())
                .chain(self.selected_id.iter())
                .any(|id| !super::auth_contract::valid_id(id))
        {
            return Err("invalid_input".into());
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    pub id: String,
    pub title: String,
    pub description: String,
    pub excerpt: String,
    pub revision: String,
    pub created_at: String,
    pub modified_at: String,
    pub favorite: bool,
    pub archived: bool,
    pub collection_id: Option<String>,
    pub tag_ids: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub collections: Vec<super::library_contract::OrganizationEntry>,
    pub tags: Vec<super::library_contract::OrganizationEntry>,
    pub instance_id: String,
    pub account_id: String,
    pub revision: String,
    pub prompts: Vec<SearchSummary>,
    pub next_cursor: Option<String>,
    pub selected_id: Option<String>,
}
