use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rule {
    max_code_points: usize,
    whitespace: String,
}

static RULE: LazyLock<Rule> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/excerpt-rule.json"
    ))
    .expect("valid shared excerpt rule")
});

// Collapse pinned White_Space, trim, then take Unicode scalars without interpreting markup.
pub fn excerpt(content: &str) -> String {
    content
        .split(|ch| RULE.whitespace.contains(ch))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(RULE.max_code_points)
        .collect::<String>()
        .trim_end_matches(' ')
        .to_string()
}
