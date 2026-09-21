use super::local_search::{decode, normalize};
use super::search_contract::{SearchPage, SearchRequest, SearchSummary};
use rusqlite::{Connection, OptionalExtension};
use std::collections::BTreeSet;

pub fn hits(db: &Connection, field: &str, term: &str) -> rusqlite::Result<BTreeSet<u16>> {
    let points: Vec<_> = term.chars().collect();
    if points.len() < 3 {
        let value: Option<(String, Vec<u8>)> = db
            .query_row(
                "SELECT representation,payload FROM local_search_short WHERE field=?1 AND gram=?2",
                [field, term],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        return value.map_or_else(
            || Ok(BTreeSet::new()),
            |(kind, bytes)| decode(&kind, &bytes),
        );
    }
    let grams: BTreeSet<String> = points
        .windows(3)
        .map(|p| format!("\"{}\"", p.iter().collect::<String>().replace('"', "\"\"")))
        .collect();
    let query = grams.into_iter().collect::<Vec<_>>().join(" AND ");
    db.prepare(&format!(
        "SELECT rowid FROM local_f_{field} WHERE local_f_{field} MATCH ?1"
    ))?
    .query_map([query], |r| r.get(0))?
    .collect()
}
struct Term {
    value: String,
    title: BTreeSet<u16>,
    description: BTreeSet<u16>,
    content: BTreeSet<u16>,
    organization: BTreeSet<u16>,
    short: bool,
}
struct Candidate {
    slot: u16,
    id: String,
    title: String,
    created: String,
    modified: String,
    used: Option<String>,
    bytes: usize,
    tier: u8,
    outstanding: Vec<usize>,
}
fn organization_hits(db: &Connection, term: &str) -> rusqlite::Result<BTreeSet<u16>> {
    let candidates = hits(db, "name", term)?;
    let mut result = BTreeSet::new();
    let mut names = db.prepare("SELECT slot,kind,id,name FROM search_organization")?;
    let rows = names.query_map([], |r| {
        Ok((
            r.get::<_, u16>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    for row in rows {
        let (slot, kind, id, name) = row?;
        if candidates.contains(&slot) && name.contains(term) {
            result.extend(
                db.prepare("SELECT slot FROM search_membership WHERE kind=?1 AND id=?2")?
                    .query_map([kind, id], |r| r.get::<_, u16>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?,
            );
        }
    }
    Ok(result)
}
fn candidates(
    db: &Connection,
    request: &SearchRequest,
    query: &str,
    terms: &[Term],
) -> rusqlite::Result<Vec<Candidate>> {
    let selected_tags: BTreeSet<&str> = request.tag_ids.iter().map(String::as_str).collect();
    let mut result = Vec::new();
    let mut eligible: Option<BTreeSet<u16>> = None;
    for term in terms {
        let union: BTreeSet<_> = term
            .title
            .iter()
            .chain(&term.description)
            .chain(&term.content)
            .chain(&term.organization)
            .copied()
            .collect();
        eligible = Some(match eligible {
            Some(previous) => previous.intersection(&union).copied().collect(),
            None => union,
        });
    }
    let condition = eligible.map_or_else(String::new, |slots| {
        format!(
            " WHERE m.slot IN ({})",
            slots
                .into_iter()
                .map(|slot| slot.to_string())
                .collect::<Vec<_>>()
                .join(",")
        )
    });
    let mut statement = db.prepare(&format!("SELECT m.slot,m.id,m.title,m.description,m.content_bytes,m.created,m.modified,m.used,m.archived,m.favorite,m.collection_id,m.tags FROM search_metadata m{condition}"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let archived: bool = row.get(8)?;
        let favorite: bool = row.get(9)?;
        let collection: Option<String> = row.get(10)?;
        let used: Option<String> = row.get(7)?;
        if archived != (request.view == "archive")
            || request.view == "favorites" && !favorite
            || request.view == "recents" && used.is_none()
            || request.favorite.is_some_and(|value| value != favorite)
            || request
                .collection_id
                .as_ref()
                .is_some_and(|id| Some(id) != collection.as_ref())
            || request
                .view_collection_id
                .as_ref()
                .is_some_and(|id| Some(id) != collection.as_ref())
        {
            continue;
        }
        let tags: String = row.get(11)?;
        let tags: BTreeSet<String> =
            serde_json::from_str(&tags).map_err(|_| rusqlite::Error::InvalidQuery)?;
        if !selected_tags.iter().all(|t| tags.contains(*t)) {
            continue;
        }
        let slot: u16 = row.get(0)?;
        let title: String = row.get(2)?;
        let description: String = row.get(3)?;
        let mut title_count = 0;
        let mut tier = 6;
        let mut outstanding = Vec::new();
        let mut eligible = true;
        for (index, term) in terms.iter().enumerate() {
            let in_title = term.title.contains(&slot) && title.contains(&term.value);
            let in_description =
                term.description.contains(&slot) && description.contains(&term.value);
            let in_organization = term.organization.contains(&slot);
            title_count += usize::from(in_title);
            if in_description {
                tier = tier.min(5);
            }
            if in_organization {
                tier = tier.min(4);
            }
            if in_title {
                tier = tier.min(3);
            }
            if !in_title && !in_description && !in_organization {
                if !term.content.contains(&slot) {
                    eligible = false;
                    break;
                }
                if !term.short {
                    outstanding.push(index);
                }
            }
        }
        if !eligible {
            continue;
        }
        if title_count == terms.len() {
            tier = 2;
        }
        if title == query {
            tier = 1;
        }
        result.push(Candidate {
            slot,
            id: row.get(1)?,
            title,
            created: row.get(5)?,
            modified: row.get(6)?,
            used,
            bytes: row.get::<_, u32>(4)? as usize,
            tier,
            outstanding,
        });
    }
    let sort = request.sort.as_str();
    result.sort_by(|a, b| {
        use std::cmp::Ordering::Equal;
        let recent = b.used.cmp(&a.used);
        let primary = match sort {
            "relevance" if !query.is_empty() => a
                .tier
                .cmp(&b.tier)
                .then(recent)
                .then(b.modified.cmp(&a.modified)),
            "recently-used" => recent.then(if a.used.is_none() && b.used.is_none() {
                b.modified.cmp(&a.modified)
            } else {
                Equal
            }),
            "recently-modified" | "relevance" => b.modified.cmp(&a.modified),
            "newest" => b.created.cmp(&a.created),
            "oldest" => a.created.cmp(&b.created),
            _ => Equal,
        };
        primary.then(a.title.cmp(&b.title)).then(a.id.cmp(&b.id))
    });
    Ok(result)
}
fn signature(request: &SearchRequest, revision: i64, offset: usize, secret: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut bound = request.clone();
    bound.cursor = None;
    bound.selected_id = None;
    bound.request_id.clear();
    format!(
        "{:x}",
        Sha256::digest(format!(
            "{}:{revision}:{offset}:pr0-search-v1-ucd17:{secret}",
            serde_json::to_string(&bound).expect("serializable request")
        ))
    )
}
fn recovery(_: rusqlite::Error) -> String {
    "search_recovery_required".into()
}
fn organization_entries(
    db: &Connection,
    kind: &str,
) -> rusqlite::Result<Vec<super::library_contract::OrganizationEntry>> {
    let mut entries = Vec::new();
    let mut statement=db.prepare("SELECT json_object('id',o.id,'name',o.name,'revision',o.revision,'activeCount',0,'archivedCount',0,'totalCount',0),(SELECT count(*) FROM search_membership x JOIN search_metadata m USING(slot) WHERE x.kind=o.kind AND x.id=o.id AND m.archived=0),(SELECT count(*) FROM search_membership x JOIN search_metadata m USING(slot) WHERE x.kind=o.kind AND x.id=o.id AND m.archived=1) FROM organization_local o WHERE kind=?1 ORDER BY name COLLATE BINARY,id")?;
    for row in statement.query_map([kind], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, u32>(1)?,
            r.get::<_, u32>(2)?,
        ))
    })? {
        let (record, active, archived) = row?;
        let mut entry: super::library_contract::OrganizationEntry =
            serde_json::from_str(&record).map_err(|_| rusqlite::Error::InvalidQuery)?;
        entry.active_count = active;
        entry.archived_count = archived;
        entry.total_count = active + archived;
        entries.push(entry);
    }
    entries.sort_by_cached_key(|entry| (normalize(&entry.name), entry.id.clone()));
    Ok(entries)
}
pub fn search(
    db: &Connection,
    request: &SearchRequest,
    cancelled: &impl Fn() -> bool,
) -> Result<SearchPage, String> {
    let check = || {
        if cancelled() {
            Err("operation_cancelled".to_string())
        } else {
            Ok(())
        }
    };
    check()?;
    let compatible:bool=db.query_row("SELECT version=2 AND normalization='pr0-search-v1-ucd17' FROM local_search_version WHERE singleton=1",[],|r|r.get(0)).map_err(recovery)?;
    if !compatible {
        return Err("search_recovery_required".into());
    }
    let (revision, secret): (i64, String) = db
        .query_row("SELECT revision,installation FROM local_state", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(recovery)?;
    let mut offset = 0;
    if let Some(cursor) = &request.cursor {
        let parts: Vec<_> = cursor.split(':').collect();
        if parts.len() != 3 {
            return Err("invalid_cursor".into());
        }
        if parts[0] != revision.to_string() {
            return Err("results_changed".into());
        }
        offset = parts[1].parse().map_err(|_| "invalid_cursor")?;
        if offset > 10000 || signature(request, revision, offset, &secret) != parts[2] {
            return Err("invalid_cursor".into());
        }
    }
    let query = normalize(&request.query);
    let mut terms = Vec::new();
    for term in query
        .split(' ')
        .filter(|t| !t.is_empty())
        .collect::<BTreeSet<_>>()
    {
        check()?;
        terms.push(Term {
            value: term.into(),
            title: hits(db, "title", term).map_err(recovery)?,
            description: hits(db, "description", term).map_err(recovery)?,
            content: hits(db, "content", term).map_err(recovery)?,
            organization: organization_hits(db, term).map_err(recovery)?,
            short: term.chars().count() < 3,
        });
    }
    let candidates = candidates(db, request, &query, &terms).map_err(recovery)?;
    let mut accepted = 0;
    let mut prompts = Vec::new();
    let mut next_cursor = None;
    let selected_match = if let Some(candidate) = candidates
        .iter()
        .find(|c| Some(&c.id) == request.selected_id.as_ref())
    {
        let matches = if candidate.outstanding.is_empty() {
            true
        } else {
            let body: String = db
                .query_row(
                    "SELECT content FROM local_search WHERE slot=?1",
                    [candidate.slot],
                    |r| r.get(0),
                )
                .map_err(recovery)?;
            candidate
                .outstanding
                .iter()
                .all(|i| body.contains(&terms[*i].value))
        };
        Some((candidate.slot, matches))
    } else {
        None
    };
    let selected = selected_match
        .filter(|(_, matches)| *matches)
        .and(request.selected_id.clone());
    let mut position = 0;
    while position < candidates.len() {
        check()?;
        let start = position;
        let mut bytes = 0;
        while position < candidates.len() && position - start < 64 {
            let cost = if candidates[position].outstanding.is_empty() {
                0
            } else {
                candidates[position].bytes
            };
            if position > start && bytes + cost > 4_194_304 {
                break;
            }
            bytes += cost;
            position += 1;
        }
        let batch = &candidates[start..position];
        let slots = batch
            .iter()
            .filter(|c| {
                !c.outstanding.is_empty() && selected_match.is_none_or(|(slot, _)| slot != c.slot)
            })
            .map(|c| c.slot.to_string())
            .collect::<Vec<_>>();
        let bodies = if slots.is_empty() {
            std::collections::BTreeMap::new()
        } else {
            db.prepare(&format!(
                "SELECT slot,content FROM local_search WHERE slot IN ({})",
                slots.join(",")
            ))
            .map_err(recovery)?
            .query_map([], |r| Ok((r.get::<_, u16>(0)?, r.get::<_, String>(1)?)))
            .map_err(recovery)?
            .collect::<rusqlite::Result<std::collections::BTreeMap<_, _>>>()
            .map_err(recovery)?
        };
        for candidate in batch {
            let matches = if let Some((_, matches)) =
                selected_match.filter(|(slot, _)| *slot == candidate.slot)
            {
                matches
            } else {
                candidate.outstanding.iter().all(|i| {
                    bodies
                        .get(&candidate.slot)
                        .is_some_and(|body| body.contains(&terms[*i].value))
                })
            };
            if !matches {
                continue;
            }
            if accepted >= offset && prompts.len() < request.limit {
                let summary: String = db
                    .query_row(
                        "SELECT summary FROM search_metadata WHERE slot=?1",
                        [candidate.slot],
                        |r| r.get(0),
                    )
                    .map_err(recovery)?;
                prompts.push(
                    serde_json::from_str::<SearchSummary>(&summary)
                        .map_err(|_| "search_recovery_required")?,
                );
            } else if accepted >= offset + request.limit && next_cursor.is_none() {
                let next = offset + request.limit;
                next_cursor = Some(format!(
                    "{revision}:{next}:{}",
                    signature(request, revision, next, &secret)
                ));
            }
            accepted += 1;
        }
        // Selection beyond the current page is checked by identity, never row position.
        if next_cursor.is_some() {
            break;
        }
    }
    check()?;
    Ok(SearchPage {
        collections: organization_entries(db, "collection").map_err(recovery)?,
        tags: organization_entries(db, "tag").map_err(recovery)?,
        instance_id: request.instance_id.clone(),
        account_id: request.account_id.clone(),
        revision: revision.to_string(),
        selected_id: selected.or_else(|| prompts.first().map(|p| p.id.clone())),
        prompts,
        next_cursor,
    })
}
