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
pub fn trim_name(value: &str) -> &str {
    value.trim_matches(|c: char| unicode::WHITE_SPACE.contains(&u32::from(c)))
}
fn nfc(input: impl IntoIterator<Item = u32>) -> Vec<u32> {
    let mut result: Vec<u32> = Vec::new();
    let mut starter = 0;
    let mut previous_class = 0;
    for cp in nfd(input) {
        let class = unicode::COMBINING
            .binary_search_by_key(&cp, |e| e.0)
            .map_or(0, |i| unicode::COMBINING[i].1);
        let composed = result.get(starter).and_then(|a| {
            if (0x1100..0x1113).contains(a) && (0x1161..0x1176).contains(&cp) {
                return Some(0xac00 + (a - 0x1100) * 588 + (cp - 0x1161) * 28);
            }
            if (0xac00..0xd7a4).contains(a)
                && (a - 0xac00) % 28 == 0
                && (0x11a8..0x11c3).contains(&cp)
            {
                return Some(a + cp - 0x11a7);
            }
            unicode::COMPOSITION
                .iter()
                .find(|e| e.0 == (*a, cp))
                .map(|e| e.1)
        });
        if let Some(composed) = composed.filter(|_| previous_class == 0 || previous_class < class) {
            result[starter] = composed;
        } else {
            if class == 0 {
                starter = result.len();
            }
            result.push(cp);
            previous_class = class;
        }
    }
    result
}
pub fn organization_identity(value: &str) -> String {
    let folded = nfc(trim_name(value).chars().map(u32::from))
        .into_iter()
        .flat_map(|cp| {
            unicode::CASEFOLD
                .binary_search_by_key(&cp, |e| e.0)
                .map_or_else(|_| vec![cp], |i| unicode::CASEFOLD[i].1.to_vec())
        });
    nfc(folded).into_iter().filter_map(char::from_u32).collect()
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
fn encode(slots: &BTreeSet<u16>, capacity: usize) -> (&'static str, Vec<u8>) {
    let mut runs: Vec<(u16, u16)> = Vec::new();
    for slot in slots {
        match runs.last_mut() {
            Some((start, length)) if *start + *length == *slot => *length += 1,
            _ => runs.push((*slot, 1)),
        }
    }
    let bitmap_bytes = capacity.div_ceil(8);
    if bitmap_bytes < slots.len() * 2 && bitmap_bytes < runs.len() * 4 {
        let mut bytes = vec![0u8; bitmap_bytes];
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
pub(super) fn decode(kind: &str, bytes: &[u8]) -> rusqlite::Result<BTreeSet<u16>> {
    let mut slots = BTreeSet::new();
    match kind {
        "bitmap" if bytes.len() == 1250 || bytes.len() == 150 => {
            for slot in 0..bytes.len() * 8 {
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
        // Dense sequential downloads use a single persisted run. Extend its endpoint
        // without expanding thousands of addresses for each common short gram.
        if let Some((kind, bytes)) = &previous {
            if kind == "runs" && bytes.len() == 4 && next.contains(gram) {
                let start = u16::from_le_bytes([bytes[0], bytes[1]]);
                let length = u16::from_le_bytes([bytes[2], bytes[3]]);
                if start.checked_add(length) == Some(slot) && slot < 10000 {
                    let length = length + 1;
                    let payload: Vec<_> = start
                        .to_le_bytes()
                        .into_iter()
                        .chain(length.to_le_bytes())
                        .collect();
                    tx.execute("UPDATE local_search_short SET payload=?3,count=?4 WHERE field=?1 AND gram=?2",params![field,gram,payload,length])?;
                    continue;
                }
            }
        }
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
            let (kind, bytes) = encode(&slots, if field == "name" { 1200 } else { 10000 });
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
    if slot >= 10000 {
        return Err(rusqlite::Error::InvalidQuery);
    }
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

// Triggers record affected identities, never text. The owner drains this queue before
// committing primary data and the outbox, so no successful write exposes stale search.
pub fn upgrade(db: &mut Connection) -> rusqlite::Result<()> {
    preflight(db)?;
    let tx = db.transaction()?;
    tx.execute_batch(
        "DROP TABLE local_f_title; DROP TABLE local_f_description; DROP TABLE local_f_content;
        DROP TABLE local_search; DROP TABLE local_search_short; DROP TABLE local_search_version;",
    )?;
    create(&tx)?;
    tx.execute_batch("CREATE TABLE search_dirty(id TEXT PRIMARY KEY,text_changed INTEGER NOT NULL);
        CREATE TABLE search_org_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),dirty INTEGER NOT NULL);
        INSERT INTO search_org_state VALUES(1,1);
        CREATE TRIGGER search_active AFTER UPDATE OF active ON state BEGIN
          UPDATE search_org_state SET dirty=1;
          INSERT INTO search_dirty SELECT id,1 FROM visible_prompt WHERE true ON CONFLICT(id) DO UPDATE SET text_changed=1;
          INSERT INTO search_dirty SELECT id,1 FROM local_search WHERE true ON CONFLICT(id) DO UPDATE SET text_changed=1;
        END;")?;
    for action in ["INSERT", "UPDATE", "DELETE"] {
        tx.execute_batch(&format!("CREATE TRIGGER search_org_{action} AFTER {action} ON organization BEGIN UPDATE search_org_state SET dirty=1; END;"))?;
    }
    for table in ["prompt", "local_prompt"] {
        for (action, reference) in [("INSERT", "NEW"), ("DELETE", "OLD"), ("UPDATE", "NEW")] {
            let text_changed = if action == "UPDATE" {
                "json_extract(OLD.record,'$.title')<>json_extract(NEW.record,'$.title') OR json_extract(OLD.record,'$.description')<>json_extract(NEW.record,'$.description') OR json_extract(OLD.record,'$.content')<>json_extract(NEW.record,'$.content')"
            } else {
                "1"
            };
            tx.execute_batch(&format!("CREATE TRIGGER search_{table}_{action} AFTER {action} ON {table} BEGIN
                INSERT INTO search_dirty VALUES({reference}.id,{text_changed}) ON CONFLICT(id) DO UPDATE SET text_changed=max(text_changed,excluded.text_changed); END;"))?;
        }
    }
    for (action, reference) in [("INSERT", "NEW"), ("DELETE", "OLD"), ("UPDATE", "NEW")] {
        tx.execute_batch(&format!(
            "CREATE TRIGGER search_usage_{action} AFTER {action} ON pending_usage BEGIN
            INSERT INTO search_dirty VALUES({reference}.prompt_id,0) ON CONFLICT(id) DO NOTHING;
            UPDATE local_state SET revision=revision+1; END;"
        ))?;
    }
    tx.execute_batch(
        "INSERT INTO search_dirty SELECT id,1 FROM visible_prompt; PRAGMA user_version=7;",
    )?;
    flush(&tx)?;
    tx.commit()
}
// Version 8 joins the search and organization previews without rebuilding prompt text.
pub fn integrate_organization(db: &mut Connection) -> rusqlite::Result<()> {
    let tx = db.transaction()?;
    for action in ["INSERT", "UPDATE", "DELETE"] {
        tx.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS search_projected_org_{action} AFTER {action} ON organization_local BEGIN UPDATE search_org_state SET dirty=1; END;"))?;
    }
    tx.execute_batch("UPDATE search_org_state SET dirty=1;
        INSERT INTO search_dirty SELECT id,0 FROM visible_prompt WHERE true ON CONFLICT(id) DO NOTHING;
        PRAGMA user_version=8;")?;
    flush(&tx)?;
    tx.commit()
}
fn create(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch("CREATE TABLE local_search(slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 0 AND 9999),id TEXT UNIQUE NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,content TEXT NOT NULL,content_bytes INTEGER NOT NULL,revision INTEGER NOT NULL);
        CREATE TABLE local_search_short(field TEXT NOT NULL,gram TEXT NOT NULL,representation TEXT NOT NULL,payload BLOB NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(field,gram)) WITHOUT ROWID;
        CREATE TABLE local_search_version(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL,normalization TEXT NOT NULL);
        INSERT INTO local_search_version VALUES(1,2,'pr0-search-v1-ucd17');
        CREATE TABLE search_metadata(slot INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,summary TEXT NOT NULL,created TEXT NOT NULL,modified TEXT NOT NULL,used TEXT,archived INTEGER NOT NULL,favorite INTEGER NOT NULL,collection_id TEXT,tags TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,content_bytes INTEGER NOT NULL);")?;
    db.execute_batch("CREATE TABLE search_organization(slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 0 AND 1199),kind TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(kind,id));
        CREATE VIRTUAL TABLE local_f_name USING fts5(name,content='search_organization',content_rowid='slot',detail=none,columnsize=0,tokenize='trigram case_sensitive 1');
        CREATE TABLE search_membership(kind TEXT NOT NULL,id TEXT NOT NULL,slot INTEGER NOT NULL,PRIMARY KEY(kind,id,slot)) WITHOUT ROWID;
        CREATE INDEX search_membership_slot ON search_membership(slot);")?;
    for field in ["title", "description", "content"] {
        db.execute_batch(&format!("CREATE VIRTUAL TABLE local_f_{field} USING fts5({field},content='local_search',content_rowid='slot',detail=none,columnsize=0,tokenize='trigram case_sensitive 1');"))?;
    }
    Ok(())
}
pub fn rebuild(db: &mut Connection) -> rusqlite::Result<()> {
    preflight(db)?;
    // SQLite stages all replacement pages in the WAL. Readers keep their old snapshot;
    // an I/O failure rolls back the replacement without changing primary data/outbox.
    let tx = db.transaction()?;
    tx.execute_batch(
        "DROP TABLE IF EXISTS local_f_title; DROP TABLE IF EXISTS local_f_description;
        DROP TABLE IF EXISTS local_f_content; DROP TABLE IF EXISTS local_f_name;
        DROP TABLE IF EXISTS local_search; DROP TABLE IF EXISTS local_search_short;
        DROP TABLE IF EXISTS local_search_version; DROP TABLE IF EXISTS search_metadata;
        DROP TABLE IF EXISTS search_organization; DROP TABLE IF EXISTS search_membership;",
    )?;
    create(&tx)?;
    tx.execute_batch(
        "DELETE FROM search_dirty; INSERT INTO search_dirty SELECT id,1 FROM visible_prompt;
        UPDATE search_org_state SET dirty=1;
        UPDATE local_state SET revision=revision+1;",
    )?;
    flush(&tx)?;
    tx.commit()
}
fn preflight(db: &Connection) -> rusqlite::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let pages = db.query_row("PRAGMA page_count", [], |r| r.get::<_, u32>(0))? as u64;
        let size = db.query_row("PRAGMA page_size", [], |r| r.get::<_, u32>(0))? as u64;
        let path = std::path::Path::new(db.path().ok_or(rusqlite::Error::InvalidQuery)?)
            .parent()
            .ok_or(rusqlite::Error::InvalidQuery)?;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut available = 0u64;
        // The UTF-16 path is terminated and both output pointers are valid for this call.
        let success = unsafe {
            windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        let reserve = pages
            .saturating_mul(size)
            .saturating_mul(4)
            .saturating_add(16 * 1024 * 1024);
        if success == 0 || available < reserve {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_FULL),
                Some("Insufficient index recovery scratch space".into()),
            ));
        }
    }
    Ok(())
}
pub fn flush(tx: &Transaction) -> rusqlite::Result<()> {
    if tx.query_row("SELECT dirty FROM search_org_state", [], |r| {
        r.get::<_, bool>(0)
    })? {
        organization(tx)?;
        tx.execute("UPDATE search_org_state SET dirty=0", [])?;
    }
    let dirty = tx
        .prepare("SELECT id,text_changed FROM search_dirty")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let revision: i64 = tx.query_row("SELECT revision FROM local_state", [], |r| r.get(0))?;
    let mut visible = Vec::new();
    // Reclaim every obsolete slot before allocating replacements at full capacity.
    for (id, text_changed) in dirty {
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM visible_prompt WHERE id=?1)",
            [&id],
            |r| r.get(0),
        )?;
        if !exists {
            tx.execute("DELETE FROM search_membership WHERE slot=(SELECT slot FROM local_search WHERE id=?1)",[&id])?;
            remove(tx, &id)?;
            tx.execute("DELETE FROM search_metadata WHERE id=?1", [&id])?;
            continue;
        }
        visible.push((id, text_changed));
    }
    for (id, text_changed) in visible {
        let indexed: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM local_search WHERE id=?1)",
            [&id],
            |r| r.get(0),
        )?;
        if text_changed || !indexed {
            let record: String = tx.query_row(
                "SELECT record FROM visible_prompt WHERE id=?1",
                [&id],
                |r| r.get(0),
            )?;
            let prompt: Prompt =
                serde_json::from_str(&record).map_err(|_| rusqlite::Error::InvalidQuery)?;
            update(tx, &prompt, revision)?;
        }
        let assignments_changed:bool=tx.query_row("SELECT NOT EXISTS(SELECT 1 FROM search_metadata m JOIN visible_prompt v USING(id) WHERE m.id=?1 AND m.collection_id IS json_extract(v.record,'$.collectionId') AND m.tags=json_extract(v.record,'$.tagIds'))",[&id],|r|r.get(0))?;
        tx.execute("INSERT OR REPLACE INTO search_metadata
            SELECT s.slot,v.id,json_remove(v.record,'$.content','$.instanceId','$.accountId','$.useCount','$.lastUsedAt','$.sourceTitle'),
            json_extract(v.record,'$.createdAt'),json_extract(v.record,'$.modifiedAt'),
            nullif(max(coalesce((SELECT json_extract(record,'$.lastUsedAt') FROM prompt WHERE snapshot=(SELECT active FROM state) AND id=v.id),''),coalesce((SELECT max(coalesce(json_extract(receipt,'$.usedAt'),occurred_at)) FROM pending_usage WHERE prompt_id=v.id),'')),''),
            v.archived,json_extract(v.record,'$.favorite'),json_extract(v.record,'$.collectionId'),json_extract(v.record,'$.tagIds'),s.title,s.description,s.content_bytes
            FROM visible_prompt v JOIN local_search s USING(id) WHERE v.id=?1", [&id])?;
        if assignments_changed {
            tx.execute(
            "DELETE FROM search_membership WHERE slot=(SELECT slot FROM local_search WHERE id=?1)",
            [&id],
        )?;
            tx.execute("INSERT INTO search_membership SELECT 'tag',j.value,m.slot FROM search_metadata m,json_each(m.tags) j WHERE m.id=?1 UNION ALL SELECT 'collection',collection_id,slot FROM search_metadata WHERE id=?1 AND collection_id IS NOT NULL", [&id])?;
        }
    }
    tx.execute("DELETE FROM search_dirty", [])?;
    Ok(())
}

fn organization(tx: &Transaction) -> rusqlite::Result<()> {
    use std::collections::BTreeMap;
    let names = tx
        .prepare("SELECT kind,id,name FROM organization_local")?
        .query_map([], |r| {
            Ok((
                (r.get::<_, String>(0)?, r.get::<_, String>(1)?),
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()?;
    let old = tx
        .prepare("SELECT kind,id,slot,name FROM search_organization")?
        .query_map([], |r| {
            Ok((
                (r.get::<_, String>(0)?, r.get::<_, String>(1)?),
                (r.get::<_, u16>(2)?, r.get::<_, String>(3)?),
            ))
        })?
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()?;
    let mut used: BTreeSet<u16> = old.values().map(|v| v.0).collect();
    for (key, (slot, before)) in &old {
        if !names.contains_key(key) {
            tx.execute(
                "INSERT INTO local_f_name(local_f_name,rowid,name) VALUES('delete',?1,?2)",
                params![slot, before],
            )?;
            postings(tx, "name", *slot, before, "")?;
            tx.execute("DELETE FROM search_organization WHERE slot=?1", [slot])?;
            used.remove(slot);
        }
    }
    for ((kind, id), name) in names {
        let name = normalize(&name);
        let previous = old.get(&(kind.clone(), id.clone()));
        if previous.is_some_and(|(_, before)| before == &name) {
            continue;
        }
        let slot = match previous {
            Some((slot, before)) => {
                tx.execute(
                    "INSERT INTO local_f_name(local_f_name,rowid,name) VALUES('delete',?1,?2)",
                    params![slot, before],
                )?;
                *slot
            }
            None => (0..1200)
                .find(|slot| !used.contains(slot))
                .ok_or(rusqlite::Error::InvalidQuery)?,
        };
        postings(
            tx,
            "name",
            slot,
            previous.map_or("", |p| p.1.as_str()),
            &name,
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO search_organization VALUES(?1,?2,?3,?4)",
            params![slot, kind, id, name],
        )?;
        tx.execute(
            "INSERT INTO local_f_name(rowid,name) VALUES(?1,?2)",
            params![slot, name],
        )?;
        used.insert(slot);
    }
    Ok(())
}
