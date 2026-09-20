//! Derived search state for local overlays. Downloaded generations remain a separate baseline.
use super::library_contract::Prompt;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::BTreeSet;

#[allow(dead_code)]
// Preserve the layout owned by the shared Unicode generator.
#[rustfmt::skip]
#[path = "../../../../packages/api-contract/unicode/unicode17.rs"]
mod unicode;

fn decompose(cp: u32, output: &mut Vec<u32>) {
    if (0xac00..0xac00 + 11172).contains(&cp) {
        let syllable = cp - 0xac00;
        output.extend([0x1100 + syllable / 588, 0x1161 + (syllable % 588) / 28]);
        if syllable % 28 != 0 {
            output.push(0x11a7 + syllable % 28);
        }
    } else if let Ok(index) = unicode::DECOMPOSITION.binary_search_by_key(&cp, |entry| entry.0) {
        for child in unicode::DECOMPOSITION[index].1 {
            decompose(*child, output);
        }
    } else {
        output.push(cp);
    }
}
fn nfd(input: impl IntoIterator<Item = u32>) -> Vec<u32> {
    let mut decomposed = Vec::new();
    for cp in input {
        decompose(cp, &mut decomposed);
    }
    let class = |cp: u32| {
        unicode::COMBINING
            .binary_search_by_key(&cp, |entry| entry.0)
            .map_or(0, |index| unicode::COMBINING[index].1)
    };
    // Stable sort each combining run, avoiding quadratic insertion for large runs.
    let mut start = 0;
    for index in 0..decomposed.len() {
        if class(decomposed[index]) == 0 {
            decomposed[start..index].sort_by_key(|cp| class(*cp));
            start = index + 1;
        }
    }
    decomposed[start..].sort_by_key(|cp| class(*cp));
    decomposed
}
pub fn normalize(value: &str) -> String {
    let mut folded = Vec::new();
    for cp in nfd(value.chars().map(u32::from)) {
        if let Ok(index) = unicode::CASEFOLD.binary_search_by_key(&cp, |entry| entry.0) {
            folded.extend_from_slice(unicode::CASEFOLD[index].1);
        } else {
            folded.push(cp);
        }
    }
    let mut output = String::new();
    let mut space = false;
    for cp in nfd(folded) {
        if unicode::DIACRITIC_MARKS.binary_search(&cp).is_ok() {
            continue;
        }
        if unicode::WHITE_SPACE.binary_search(&cp).is_ok() {
            space = !output.is_empty();
            continue;
        }
        if space {
            output.push(' ');
            space = false;
        }
        if let Some(point) = char::from_u32(cp) {
            output.push(point);
        }
    }
    output
}
pub fn migrate(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch("CREATE TABLE local_search(slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 0 AND 9999),id TEXT UNIQUE NOT NULL REFERENCES local_prompt(id),title TEXT NOT NULL,description TEXT NOT NULL,content TEXT NOT NULL,content_bytes INTEGER NOT NULL,revision INTEGER NOT NULL);
        CREATE TABLE local_search_short(field TEXT NOT NULL,gram TEXT NOT NULL,representation TEXT NOT NULL,payload BLOB NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(field,gram)) WITHOUT ROWID;
        CREATE TABLE local_search_version(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL,normalization TEXT NOT NULL);
        INSERT INTO local_search_version VALUES(1,1,'pr0-search-v1-ucd17');")?;
    for field in ["title", "description", "content"] {
        db.execute_batch(&format!("CREATE VIRTUAL TABLE local_f_{field} USING fts5({field},content='local_search',content_rowid='slot',detail=none,columnsize=0,tokenize='trigram case_sensitive 1');"))?;
    }
    Ok(())
}
fn grams(text: &str) -> BTreeSet<String> {
    let mut result = BTreeSet::new();
    let mut previous = None;
    for point in text.chars() {
        result.insert(point.to_string());
        if let Some(prev) = previous {
            result.insert(format!("{prev}{point}"));
        }
        previous = Some(point);
    }
    result
}
fn encode(slots: &BTreeSet<u16>) -> (&'static str, Vec<u8>) {
    let mut runs: Vec<(u16, u16)> = Vec::new();
    for slot in slots {
        match runs.last_mut() {
            Some((start, length)) if *start + *length == *slot => *length += 1,
            _ => runs.push((*slot, 1)),
        }
    }
    if 1250 < slots.len() * 2 && 1250 < runs.len() * 4 {
        let mut bytes = vec![0u8; 1250];
        for slot in slots {
            bytes[*slot as usize / 8] |= 1 << (*slot % 8);
        }
        ("bitmap", bytes)
    } else if runs.len() * 4 < slots.len() * 2 {
        (
            "runs",
            runs.into_iter()
                .flat_map(|(start, len)| start.to_le_bytes().into_iter().chain(len.to_le_bytes()))
                .collect(),
        )
    } else {
        (
            "sparse",
            slots.iter().flat_map(|s| s.to_le_bytes()).collect(),
        )
    }
}
fn decode(kind: &str, bytes: &[u8]) -> rusqlite::Result<BTreeSet<u16>> {
    let mut slots = BTreeSet::new();
    match kind {
        "bitmap" if bytes.len() == 1250 => {
            for slot in 0..10_000 {
                if bytes[slot / 8] & (1 << (slot % 8)) != 0 {
                    slots.insert(slot as u16);
                }
            }
        }
        "sparse" if bytes.len() % 2 == 0 => {
            for pair in bytes.chunks_exact(2) {
                slots.insert(u16::from_le_bytes([pair[0], pair[1]]));
            }
        }
        "runs" if bytes.len() % 4 == 0 => {
            for run in bytes.chunks_exact(4) {
                let start = u16::from_le_bytes([run[0], run[1]]);
                let length = u16::from_le_bytes([run[2], run[3]]);
                let end = start
                    .checked_add(length)
                    .filter(|end| *end <= 10_000)
                    .ok_or(rusqlite::Error::InvalidQuery)?;
                slots.extend(start..end);
            }
        }
        _ => return Err(rusqlite::Error::InvalidQuery),
    }
    if slots.last().is_some_and(|slot| *slot >= 10_000) {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(slots)
}
fn postings(
    tx: &Transaction,
    field: &str,
    slot: u16,
    before: &str,
    after: &str,
) -> rusqlite::Result<()> {
    let old = grams(before);
    let next = grams(after);
    for gram in old.symmetric_difference(&next) {
        let previous: Option<(String, Vec<u8>)> = tx
            .query_row(
                "SELECT representation,payload FROM local_search_short WHERE field=?1 AND gram=?2",
                params![field, gram],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let mut slots = match previous {
            Some((kind, bytes)) => decode(&kind, &bytes)?,
            None => BTreeSet::new(),
        };
        if next.contains(gram) {
            slots.insert(slot);
        } else {
            slots.remove(&slot);
        }
        if slots.is_empty() {
            tx.execute(
                "DELETE FROM local_search_short WHERE field=?1 AND gram=?2",
                params![field, gram],
            )?;
        } else {
            let (kind, bytes) = encode(&slots);
            tx.execute(
                "INSERT OR REPLACE INTO local_search_short VALUES(?1,?2,?3,?4,?5)",
                params![field, gram, kind, bytes, slots.len() as i64],
            )?;
        }
    }
    Ok(())
}
pub fn remove(tx: &Transaction, id: &str) -> rusqlite::Result<()> {
    let old: Option<(u16, [String; 3])> = tx
        .query_row(
            "SELECT slot,title,description,content FROM local_search WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, [r.get(1)?, r.get(2)?, r.get(3)?])),
        )
        .optional()?;
    if let Some((slot, values)) = old {
        for (field, before) in ["title", "description", "content"].into_iter().zip(values) {
            tx.execute(&format!("INSERT INTO local_f_{field}(local_f_{field},rowid,{field}) VALUES('delete',?1,?2)"),params![slot,before])?;
            postings(tx, field, slot, &before, "")?;
        }
        tx.execute("DELETE FROM local_search WHERE id=?1", [id])?;
    }
    Ok(())
}
pub fn update(tx: &Transaction, prompt: &Prompt, revision: i64) -> rusqlite::Result<()> {
    let old: Option<(u16, [String; 3])> = tx
        .query_row(
            "SELECT slot,title,description,content FROM local_search WHERE id=?1",
            [&prompt.id],
            |r| Ok((r.get(0)?, [r.get(1)?, r.get(2)?, r.get(3)?])),
        )
        .optional()?;
    let slot = match &old {
        Some((slot, _)) => *slot,
        None => tx.query_row(
            "SELECT coalesce((SELECT min(slot+1) FROM local_search s WHERE NOT EXISTS(SELECT 1 FROM local_search n WHERE n.slot=s.slot+1)),0) WHERE EXISTS(SELECT 1 FROM local_search WHERE slot=0) UNION ALL SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM local_search WHERE slot=0)",
            [],
            |r| r.get::<_, u16>(0),
        )?,
    };
    let values = [
        normalize(&prompt.title),
        normalize(&prompt.description),
        normalize(&prompt.content),
    ];
    for (index, field) in ["title", "description", "content"].iter().enumerate() {
        let before = old.as_ref().map(|(_, values)| values[index].as_str());
        let after = &values[index];
        if before == Some(after.as_str()) {
            continue;
        }
        if let Some(before) = before {
            tx.execute(&format!("INSERT INTO local_f_{field}(local_f_{field},rowid,{field}) VALUES('delete',?1,?2)"),params![slot,before])?;
        }
        tx.execute(
            &format!("INSERT INTO local_f_{field}(rowid,{field}) VALUES(?1,?2)"),
            params![slot, after],
        )?;
        postings(tx, field, slot, before.unwrap_or(""), after)?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO local_search VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            slot,
            prompt.id,
            values[0],
            values[1],
            values[2],
            values[2].len() as i64,
            revision
        ],
    )?;
    Ok(())
}
