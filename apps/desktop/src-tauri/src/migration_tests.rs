// Build predecessor fixtures with public command-created records. Schema surgery
// below is fixture setup only; preservation is observed through native commands.
fn predecessor(directory: &std::path::Path, version: u32) {
    let path = super::library_storage::library_path(directory,
        "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333").unwrap();
    let db = rusqlite::Connection::open(path).unwrap();
    if version < 5 { db.execute_batch("DROP TABLE change_state;").unwrap(); }
    if version < 4 { db.execute_batch("DROP TABLE pending_usage; DROP TABLE usage_state;").unwrap(); }
    if version < 3 { db.execute_batch("DROP TABLE upload_state; DROP TABLE prompt_mapping; ALTER TABLE outbox DROP COLUMN envelope; ALTER TABLE outbox DROP COLUMN receipt; ALTER TABLE outbox DROP COLUMN error; ALTER TABLE outbox DROP COLUMN next_attempt;").unwrap(); }
    if version < 2 { db.execute_batch("DROP VIEW visible_prompt; DROP TABLE outbox; DROP TABLE local_receipt; DROP TABLE local_f_title; DROP TABLE local_f_description; DROP TABLE local_f_content; DROP TABLE local_search_short; DROP TABLE local_search_version; DROP TABLE local_search; DROP TABLE local_prompt; DROP TABLE local_state; ALTER TABLE download DROP COLUMN text_bytes;").unwrap(); }
    db.pragma_update(None, "user_version", version).unwrap();
}

#[test]
fn migration_every_predecessor_preserves_exact_pending_work_and_consistent_backup() {
    for version in 1..=4 {
        let (directory, service, _) = downloaded_change_fixture();
        let request = save_request(&service);
        if version >= 2 { service.library_create(request.clone()).unwrap(); }
        let downloaded = service.library_detail("66666666-6666-4666-8666-666666666666").unwrap().content;
        let pending = serde_json::to_value(service.library_pending().unwrap()).unwrap();
        drop(service);
        predecessor(&directory, version);
        let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
        assert_eq!(service.library_detail("66666666-6666-4666-8666-666666666666").unwrap().content, downloaded);
        assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
        if version >= 2 { assert_eq!(service.library_detail(&request.prompt_id).unwrap().content, "  My complete draft\n"); }
        let path = super::library_storage::library_path(&directory, &request.instance_id, &request.account_id).unwrap();
        let backup = path.with_extension(format!("backup-v{version}.sqlite"));
        assert!(backup.is_file(), "consistent predecessor backup is required");
        drop(service);
        // Restore the backup in an isolated directory; exercise normal upgrade/open.
        let restored = directory.join("restore");
        std::fs::create_dir(&restored).unwrap();
        std::fs::copy(backup, restored.join(path.file_name().unwrap())).unwrap();
        std::fs::copy(directory.join("session-state.sqlite"), restored.join("session-state.sqlite")).unwrap();
        let service = AuthService::new(restored, approval(), Arc::new(Vault::default())).unwrap();
        assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
        assert_eq!(service.library_detail("66666666-6666-4666-8666-666666666666").unwrap().content, downloaded);
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[test]
fn migration_normalization_rebuild_preserves_primary_variants_and_resets_checkpoint() {
    let (directory, service, _) = downloaded_change_fixture();
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    let pending = serde_json::to_value(service.library_pending().unwrap()).unwrap();
    drop(service);
    let path = super::library_storage::library_path(&directory, &request.instance_id, &request.account_id).unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("UPDATE local_search_version SET normalization='old-normalization'; UPDATE change_state SET cursor='old-semantics'; UPDATE upload_state SET last_checked='2026-09-21T10:00:00.000Z';").unwrap();
    drop(db);
    let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    assert_eq!(service.library_detail(&request.prompt_id).unwrap().content, "  My complete draft\n");
    assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
    assert!(service.library_change_status().unwrap().last_checked_at.is_none());
    assert!(path.with_extension("backup-v5.sqlite").is_file());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn migration_refuses_newer_schema_and_backup_io_failure_without_changing_primary_work() {
    let (directory, service, _) = downloaded_change_fixture();
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    let pending = serde_json::to_value(service.library_pending().unwrap()).unwrap();
    drop(service);
    let path = super::library_storage::library_path(&directory, &request.instance_id, &request.account_id).unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    db.pragma_update(None, "user_version", 999).unwrap();
    drop(db);
    let before = std::fs::read(&path).unwrap();
    let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    assert_eq!(service.library_status().err().as_deref(), Some("local_update_required"));
    assert_eq!(std::fs::read(&path).unwrap(), before);
    drop(service);
    predecessor(&directory, 4);
    let backup = path.with_extension("backup-v4.preparing");
    std::fs::create_dir(&backup).unwrap();
    let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    assert_eq!(service.library_status().err().as_deref(), Some("migration_backup_failed"));
    drop(service);
    std::fs::remove_dir(backup).unwrap();
    let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
    assert_eq!(service.library_detail(&request.prompt_id).unwrap().content, "  My complete draft\n");
    service.transition(transition_request(&service, "discard", true)).unwrap();
    assert!(!path.with_extension("backup-v4.sqlite").exists());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn migration_full_volume_and_io_roll_back_every_predecessor() {
    for version in 1..=4 {
        for fault in ["full", "io"] {
            let (directory, service, _) = downloaded_change_fixture();
            let request = save_request(&service);
            if version >= 2 { service.library_create(request.clone()).unwrap(); }
            let pending = serde_json::to_value(service.library_pending().unwrap()).unwrap();
            drop(service);
            predecessor(&directory, version);
            super::library_migrations::FAULT.with(|value| *value.borrow_mut() = fault.into());
            let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
            assert_eq!(service.library_status().err().as_deref(), Some(if fault == "full" { "disk_full" } else { "storage_unavailable" }));
            drop(service);
            super::library_migrations::FAULT.with(|value| value.borrow_mut().clear());
            let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
            assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
            assert!(service.library_status().unwrap().complete);
            if version >= 2 { assert_eq!(service.library_detail(&request.prompt_id).unwrap().content, "  My complete draft\n"); }
            drop(service);
            std::fs::remove_dir_all(directory).unwrap();
        }
    }
}

#[test]
fn migration_kill_worker() {
    let Some(directory) = std::env::var_os("PR0_MIGRATION_KILL_WORKER") else { return; };
    let service = AuthService::new(directory.into(), approval(), Arc::new(Vault::default())).unwrap();
    service.library_status().unwrap();
}

#[test]
fn migration_interruption_rolls_back_every_predecessor() {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    for version in 1..=4 {
        let (directory, service, _) = downloaded_change_fixture();
        let request = save_request(&service);
        if version >= 2 { service.library_create(request.clone()).unwrap(); }
        let pending = serde_json::to_value(service.library_pending().unwrap()).unwrap();
        drop(service);
        predecessor(&directory, version);
        let mut child = Command::new(std::env::current_exe().unwrap()).args(["--exact", "auth_tests::migration_kill_worker", "--nocapture"]).env("PR0_MIGRATION_KILL_WORKER", &directory).stdout(Stdio::piped()).spawn().unwrap();
        let mut output = BufReader::new(child.stdout.take().unwrap());
        let mut line = String::new();
        loop { line.clear(); assert!(output.read_line(&mut line).unwrap() > 0); if line.trim() == "MIGRATION_STAGED" { break; } }
        child.kill().unwrap(); child.wait().unwrap();
        let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
        assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
        assert!(service.library_status().unwrap().complete);
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[test]
fn migration_broken_index_retains_browsing_during_io_failure_then_recovers() {
    let (directory, service, _) = downloaded_change_fixture();
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    let pending = serde_json::to_value(service.library_pending().unwrap()).unwrap();
    drop(service);
    let path = super::library_storage::library_path(&directory, &request.instance_id, &request.account_id).unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("DROP TABLE local_f_content").unwrap();
    drop(db);
    let blocked = path.with_extension("backup-v5.preparing");
    std::fs::create_dir(&blocked).unwrap();
    let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    assert_eq!(service.library_status().unwrap().recovery_error.as_deref(), Some("migration_backup_failed"));
    assert_eq!(service.library_detail(&request.prompt_id).unwrap().content, request.desired.content);
    assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
    assert!(!service.library_browse(0).unwrap().is_empty());
    drop(service);
    std::fs::remove_dir(blocked).unwrap();
    let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    assert!(service.library_status().unwrap().recovery_error.is_none());
    assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn migration_preserves_frozen_envelopes_and_successor_baselines() {
    for version in [3, 4] {
        let directory = std::env::temp_dir().join(format!("pr0-migrate-frozen-{}", uuid::Uuid::new_v4()));
        let transport = upload_fixture(false, false);
        transport.lose.store(true, std::sync::atomic::Ordering::SeqCst);
        let vault = Arc::new(Vault::default());
        let service = downloaded_upload_service(&directory, transport.clone(), vault.clone());
        let mut request = save_request(&service);
        let first = service.library_create(request.clone()).unwrap();
        assert_eq!(service.library_upload().unwrap().error.as_deref(), Some("network_unavailable"));
        request.operation_id = uuid::Uuid::new_v4().to_string();
        request.expected_local_revision = Some(first.local_revision);
        request.desired.content = "  Complete successor ß\n".into();
        service.library_edit(request.clone()).unwrap();
        let pending = serde_json::to_value(service.library_pending().unwrap()).unwrap();
        if version == 4 { service.library_copy(copy_request(&service, "66666666-6666-4666-8666-666666666666"), |_| Ok(())).unwrap(); }
        drop(service);
        predecessor(&directory, version);
        let service = AuthService::new(directory.clone(), transport.clone(), vault).unwrap();
        assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
        if version == 4 { assert_eq!(service.library_usage_status().unwrap().waiting, 1); }
        std::thread::sleep(std::time::Duration::from_millis(service.library_upload_status().unwrap().retry_after_ms + 25));
        assert!(service.library_upload().unwrap().error.is_none());
        let traffic = transport.traffic.lock().unwrap();
        assert!(traffic[1].0);
        assert_eq!(traffic[0].1, traffic[1].1);
        drop(traffic);
        assert_eq!(service.library_detail(&request.prompt_id).unwrap().content, "  Complete successor ß\n");
        assert_eq!(service.library_pending().unwrap()[1].payload["baseRevision"], "3");
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[test]
fn migration_missing_short_postings_rebuilds_and_allows_saving() {
    let (directory, service, _) = downloaded_change_fixture();
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    let pending = serde_json::to_value(service.library_pending().unwrap()).unwrap();
    drop(service);
    let path = super::library_storage::library_path(&directory, &request.instance_id, &request.account_id).unwrap();
    let db = rusqlite::Connection::open(path).unwrap();
    db.execute_batch("DROP TABLE local_search_short").unwrap();
    drop(db);
    let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    assert!(service.library_status().unwrap().recovery_error.is_none());
    assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
    let mut next = save_request(&service);
    next.prompt_id = uuid::Uuid::new_v4().to_string();
    next.operation_id = uuid::Uuid::new_v4().to_string();
    next.desired.content = "A fresh saved variant".into();
    service.library_create(next.clone()).unwrap();
    assert_eq!(service.library_detail(&next.prompt_id).unwrap().content, next.desired.content);
    assert_eq!(service.library_detail(&request.prompt_id).unwrap().content, request.desired.content);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
