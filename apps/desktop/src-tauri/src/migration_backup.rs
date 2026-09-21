use super::library_storage::io;
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

pub fn paths(path: &Path) -> Vec<PathBuf> {
    (1..=super::library_migrations::CURRENT_SCHEMA)
        .flat_map(|version| {
            [
                path.with_extension(format!("backup-v{version}.sqlite")),
                path.with_extension(format!("backup-v{version}.preparing")),
            ]
        })
        .flat_map(|path| sidecars(&path))
        .collect()
}
fn sidecars(path: &Path) -> Vec<PathBuf> {
    ["", "-wal", "-shm", "-journal"]
        .iter()
        .map(|suffix| {
            let mut name = path.as_os_str().to_os_string();
            name.push(suffix);
            PathBuf::from(name)
        })
        .collect()
}

#[cfg(windows)]
fn available(path: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    let directory: Vec<u16> = path
        .parent()
        .ok_or("storage_unavailable")?
        .as_os_str()
        .encode_wide()
        .chain([0])
        .collect();
    let mut bytes = 0;
    if unsafe {
        windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            directory.as_ptr(),
            &mut bytes,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err("migration_space_unknown".into());
    }
    Ok(bytes)
}
#[cfg(not(windows))]
fn available(_: &Path) -> Result<u64, String> {
    Err("migration_space_unknown".into())
}

pub fn preflight(db: &Connection, path: &Path) -> Result<(), String> {
    let pages = u64::from(
        db.query_row("PRAGMA page_count", [], |r| r.get::<_, u32>(0))
            .map_err(io)?,
    );
    let page_size = u64::from(
        db.query_row("PRAGMA page_size", [], |r| r.get::<_, u32>(0))
            .map_err(io)?,
    );
    // Measured database size, including committed WAL pages: backup, transform
    // and rollback reserve. Never assume the main file alone is the database.
    let required = pages
        .checked_mul(page_size)
        .and_then(|n| n.checked_mul(3))
        .and_then(|n| n.checked_add(16 * 1024 * 1024))
        .ok_or("migration_space_unknown")?;
    if available(path)? < required {
        return Err("migration_space_required".into());
    }
    Ok(())
}

pub fn prepare(db: &Connection, path: &Path, version: u32) -> Result<(), String> {
    preflight(db, path)?;
    let target = path.with_extension(format!("backup-v{version}.sqlite"));
    let staging = path.with_extension(format!("backup-v{version}.preparing"));
    for candidate in sidecars(&target).into_iter().chain(sidecars(&staging)) {
        if std::fs::symlink_metadata(candidate)
            .is_ok_and(|m| !m.is_file() || m.file_type().is_symlink())
        {
            return Err("migration_backup_failed".into());
        }
    }
    // The caller holds BEGIN IMMEDIATE, preventing a concurrent writer between
    // this committed snapshot and the atomic migration chain.
    for candidate in sidecars(&staging) {
        if candidate.exists() {
            std::fs::remove_file(candidate).map_err(|_| "migration_backup_failed")?;
        }
    }
    let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(io)?;
    source
        .backup("main", &staging, None)
        .map_err(|_| "migration_backup_failed")?;
    let snapshot = Connection::open(&staging).map_err(io)?;
    snapshot
        .execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;")
        .map_err(io)?;
    // A corrupt derived index must not prevent preserving healthy primary data
    // before rebuilding it. Validate every authoritative predecessor table.
    for table in [
        "identity",
        "download",
        "state",
        "organization",
        "prompt",
        "local_state",
        "local_prompt",
        "outbox",
        "local_receipt",
        "upload_state",
        "prompt_mapping",
        "pending_usage",
        "usage_state",
        "change_state",
    ] {
        let exists: bool = snapshot
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |r| r.get(0),
            )
            .map_err(io)?;
        if exists {
            let integrity: String = snapshot
                .query_row(&format!("PRAGMA quick_check({table})"), [], |r| r.get(0))
                .map_err(io)?;
            if integrity != "ok" {
                return Err("migration_backup_failed".into());
            }
        }
    }
    drop(snapshot);
    std::fs::OpenOptions::new()
        .write(true)
        .open(&staging)
        .and_then(|f| f.sync_all())
        .map_err(|_| "migration_backup_failed")?;
    publish(&staging, &target)?;
    Ok(())
}

#[cfg(windows)]
fn publish(staging: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = staging.as_os_str().encode_wide().chain([0]).collect();
    let destination: Vec<u16> = target.as_os_str().encode_wide().chain([0]).collect();
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err("migration_backup_failed".into());
    }
    Ok(())
}
#[cfg(not(windows))]
fn publish(staging: &Path, target: &Path) -> Result<(), String> {
    std::fs::rename(staging, target).map_err(|_| "migration_backup_failed".into())
}
