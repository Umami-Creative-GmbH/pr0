fn replacement_fixture() -> serde_json::Value {
    let mut data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    )).unwrap();
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    data["manifest"]["id"] = json!(id);
    for page in data["pages"].as_array_mut().unwrap() {
        page["id"] = json!(id);
    }
    data
}

#[test]
fn recovery_organization_staged_changes_do_not_modify_the_visible_baseline() {
    let (directory, service, transport) = downloaded_change_fixture();
    let tag = uuid::Uuid::new_v4().to_string();
    let prompt = "66666666-6666-4666-8666-666666666666";
    service.library_organize(organization_request(&service,json!({"kind":"tag.create","id":tag,"name":"Kept during staging"}))).unwrap();
    service.library_organize(organization_request(&service,json!({"kind":"prompt.tags","id":prompt,"add":[tag],"remove":[]}))).unwrap();
    transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_required"}));
    service.library_changes(0).unwrap();
    let data = replacement_fixture();
    let mut changes = change_fixture();
    changes["hasMore"] = json!(true);
    changes["headRevision"] = json!("4");
    changes["changes"][0]["prompts"] = json!([]);
    changes["changes"][0]["removedMemberships"] = json!([{"promptId":prompt,"tagId":tag}]);
    changes["changes"][0]["effect"] = json!({"kind":"tag.delete","sourceId":tag,"sourceName":"Kept during staging","targetId":null,"targetName":null,"activeCount":1,"archivedCount":0,"targetActiveCount":0,"targetArchivedCount":0});
    transport.0.lock().unwrap().extend([data["manifest"].clone(),data["pages"][0].clone(),data["pages"][1].clone(),changes]);
    for _ in 0..3 { service.library_download().unwrap(); }
    assert!(!service.library_status().unwrap().complete);
    assert_eq!(service.library_detail(prompt).unwrap().tag_ids,vec![tag]);
    assert!(service.library_organization().unwrap()["states"].as_array().unwrap().is_empty());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn recovery_organization_epoch_change_retains_and_blocks_old_pending_work() {
    let (directory, service, transport) = downloaded_change_fixture();
    let tag = uuid::Uuid::new_v4().to_string();
    let request = organization_request(&service, json!({"kind":"tag.create","id":tag,"name":"Offline tag"}));
    let operation_id = request.operation_id.clone();
    service.library_organize(request).unwrap();
    transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_required"}));
    service.library_changes(0).unwrap();
    let mut data = replacement_fixture();
    data["manifest"]["epoch"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    let mut changes = change_fixture();
    changes["epoch"] = data["manifest"]["epoch"].clone();
    transport.0.lock().unwrap().extend([data["manifest"].clone(),data["pages"][0].clone(),data["pages"][1].clone(),changes]);
    for _ in 0..3 { service.library_download().unwrap(); }
    let snapshot = service.library_organization().unwrap();
    assert_eq!(snapshot["pending"][0]["id"], operation_id);
    assert_eq!(snapshot["pending"][0]["error"], "recovery_required");
    let prompt = service.library_detail("66666666-6666-4666-8666-666666666666").unwrap();
    drop(service);
    let mut store = super::library_storage::LibraryStore::open(&directory,&prompt.instance_id,&prompt.account_id).unwrap();
    assert!(!store.upload_ready().unwrap());
    assert!(store.prepare_upload().unwrap().is_none());
    assert_eq!(store.organization_snapshot().unwrap()["pending"][0]["id"], operation_id);
    drop(store);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn recovery_organization_upgrades_both_version_six_schemas_without_losing_work() {
    for organization_schema in [false, true] {
        let (directory, service, _) = downloaded_change_fixture();
        let saved = service.library_create(save_request(&service)).unwrap();
        let operation = organization_request(&service,json!({"kind":"tag.create","id":uuid::Uuid::new_v4().to_string(),"name":"Kept through migration"}));
        let operation_id = operation.operation_id.clone();
        if organization_schema { service.library_organize(operation).unwrap(); }
        let prompt = saved.prompt;
        drop(service);
        let path = super::library_storage::library_path(&directory,&prompt.instance_id,&prompt.account_id).unwrap();
        let db = rusqlite::Connection::open(path).unwrap();
        if organization_schema {
            db.execute_batch("DROP TABLE recovery_state; DROP TABLE recovery_prompt; DROP TABLE recovery_work; DROP TABLE recovery_archive; DROP TABLE recovery_blocked; ALTER TABLE pending_usage DROP COLUMN recovery;").unwrap();
        } else {
            db.execute_batch("DROP VIEW visible_prompt; DROP VIEW base_visible_prompt; CREATE VIEW visible_prompt AS SELECT id,title,archived,record,text_bytes FROM local_prompt UNION ALL SELECT id,title,archived,record,text_bytes FROM prompt WHERE snapshot=(SELECT active FROM state) AND id NOT IN(SELECT id FROM local_prompt); DROP TABLE organization_known; DROP TABLE organization_checkpoint; DROP TABLE organization_ack; DROP TABLE organization_queue; DROP TABLE organization_local; DROP TABLE organization_receipt; DROP TABLE organization_removed; DROP TABLE organization_affected; DROP TABLE organization_assignment; DROP TABLE organization_membership_removal;").unwrap();
        }
        db.pragma_update(None,"user_version",6).unwrap();
        drop(db);
        let store = super::library_storage::LibraryStore::open(&directory,&prompt.instance_id,&prompt.account_id).unwrap();
        assert_eq!(store.detail(&prompt.id).unwrap().content,prompt.content);
        assert_eq!(store.pending_changes().unwrap().len(),1);
        assert!(store.recovery_browse(0).unwrap().is_empty());
        let organization = store.organization_snapshot().unwrap();
        if organization_schema { assert_eq!(organization["pending"][0]["id"],operation_id); }
        else { assert!(organization["pending"].as_array().unwrap().is_empty()); }
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[test]
fn recovery_stages_catches_up_and_switches_without_losing_pending_identities() {
    let (directory, service, transport) = downloaded_change_fixture();
    let mut checkpoint = change_fixture();
    checkpoint["revision"] = json!("2");
    checkpoint["headRevision"] = json!("2");
    checkpoint["changes"] = json!([]);
    transport.0.lock().unwrap().push(checkpoint);
    let checked = service.library_changes(0).unwrap().last_checked_at;
    assert!(checked.is_some());
    let saved = service.library_create(save_request(&service)).unwrap();
    let pending = serde_json::to_value(service.library_pending().unwrap()).unwrap();
    transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_required"}));
    service.library_changes(0).unwrap();
    assert_eq!(service.library_change_status().unwrap().last_checked_at, checked);
    assert!(!service.library_status().unwrap().complete);
    let data = replacement_fixture();
    transport.0.lock().unwrap().extend([
        data["manifest"].clone(), data["pages"][0].clone(), data["pages"][1].clone(), change_fixture()
    ]);
    service.library_download().unwrap();
    assert_eq!(service.library_browse(0).unwrap().len(), 3);
    assert!(!service.library_download().unwrap().complete);
    assert_eq!(service.library_detail("66666666-6666-4666-8666-666666666666").unwrap().title, "First");
    assert!(service.library_download().unwrap().complete);
    assert_eq!(service.library_detail("66666666-6666-4666-8666-666666666666").unwrap().content, "Remote content");
    assert_eq!(service.library_detail(&saved.prompt.id).unwrap().content, saved.prompt.content);
    assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn recovery_epoch_change_quarantines_pending_work_instead_of_reuploading_it() {
    let (directory, service, transport) = downloaded_change_fixture();
    let request = save_request(&service);
    let saved = service.library_create(request.clone()).unwrap();
    transport.0.lock().unwrap().extend([
        fixtures()["capabilities"].clone(), fixtures()["session"].clone(),
        json!({"results":[{"status":"accepted","operationId":request.operation_id,"promptId":request.prompt_id,"revision":"100","acceptedAt":"2026-09-21T10:00:00.000Z"}]})
    ]);
    assert_eq!(service.library_upload().unwrap().awaiting_download, 1);
    transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_required"}));
    service.library_changes(0).unwrap();
    let mut data = replacement_fixture();
    data["manifest"]["epoch"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    let mut changes = change_fixture();
    changes["epoch"] = data["manifest"]["epoch"].clone();
    transport.0.lock().unwrap().extend([
        data["manifest"].clone(), data["pages"][0].clone(), data["pages"][1].clone(), changes
    ]);
    for _ in 0..3 { service.library_download().unwrap(); }
    assert!(service.library_status().unwrap().complete);
    assert_eq!(service.library_detail(&saved.prompt.id).unwrap().content, saved.prompt.content);
    let status = service.library_upload_status().unwrap();
    assert_eq!(status.errors.len(), 1);
    assert_eq!(status.errors[0].code, "recovery_required");
    assert!(service.library_editor(&saved.prompt.id).unwrap().pending);
    let archive = service.library_recovery_browse(0).unwrap();
    assert_eq!(archive.len(), 3);
    let entry = archive.iter().find(|entry| entry.prompt_id == saved.prompt.id).unwrap();
    assert_eq!(service.library_recovery_detail(&entry.snapshot_id, &entry.prompt_id).unwrap().content, saved.prompt.content);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn recovery_insufficient_scratch_space_keeps_the_old_library_and_pending_edits() {
    let (directory, service, transport) = downloaded_change_fixture();
    let saved = service.library_create(save_request(&service)).unwrap();
    transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_required"}));
    service.library_changes(0).unwrap();
    transport.0.lock().unwrap().extend([replacement_fixture()["manifest"].clone(), replacement_fixture()["pages"][0].clone()]);
    super::library_storage::set_test_fault("scratch_space");
    let result = service.library_download();
    super::library_storage::set_test_fault("");
    assert_eq!(result.err().as_deref(), Some("insufficient_scratch_space"));
    assert_eq!(service.library_browse(0).unwrap().len(), 3);
    assert_eq!(service.library_detail(&saved.prompt.id).unwrap().content, saved.prompt.content);
    assert_eq!(service.library_pending().unwrap().len(), 1);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn recovery_pause_expiry_and_bad_digest_preserve_usable_records() {
    let (directory, service, transport) = downloaded_change_fixture();
    let saved = service.library_create(save_request(&service)).unwrap();
    transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_required"}));
    service.library_changes(0).unwrap();
    let data = replacement_fixture();
    transport.0.lock().unwrap().extend([data["manifest"].clone(), data["pages"][0].clone()]);
    service.library_download().unwrap();
    service.library_pause_download(true).unwrap();
    assert!(service.library_download().unwrap().paused);
    assert_eq!(service.library_status().unwrap().applied_pages, 1);
    service.library_pause_download(false).unwrap();
    let mut corrupt = data["pages"][1].clone();
    corrupt["payload"] = json!("corrupt");
    transport.0.lock().unwrap().push(corrupt);
    assert_eq!(service.library_download().err().as_deref(), Some("snapshot_digest_mismatch"));
    transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_expired"}));
    assert_eq!(service.library_download().err().as_deref(), Some("snapshot_expired"));
    assert!(!service.library_status().unwrap().complete);
    assert_eq!(service.library_browse(0).unwrap().len(), 3);
    transport.0.lock().unwrap().extend([data["manifest"].clone(), data["pages"][0].clone(), data["pages"][1].clone(), change_fixture()]);
    for _ in 0..3 { service.library_download().unwrap(); }
    assert!(service.library_status().unwrap().complete);
    assert_eq!(service.library_detail(&saved.prompt.id).unwrap().content, saved.prompt.content);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn recovery_edit_during_epoch_staging_requires_review_after_activation() {
    let (directory, service, transport) = downloaded_change_fixture();
    transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_required"}));
    service.library_changes(0).unwrap();
    let mut data = replacement_fixture();
    data["manifest"]["epoch"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    let mut change = change_fixture();
    change["epoch"] = data["manifest"]["epoch"].clone();
    transport.0.lock().unwrap().extend([data["manifest"].clone(),data["pages"][0].clone(),data["pages"][1].clone(),change]);
    service.library_download().unwrap();
    let prior = service.library_editor("66666666-6666-4666-8666-666666666666").unwrap();
    let mut edit = save_request(&service);
    edit.prompt_id = prior.prompt.id;
    edit.expected_local_revision = Some(prior.local_revision);
    edit.desired.content = "Saved while restoring".into();
    service.library_edit(edit.clone()).unwrap();
    service.library_download().unwrap();
    service.library_download().unwrap();
    assert_eq!(service.library_detail(&edit.prompt_id).unwrap().content, "Saved while restoring");
    let status = service.library_upload_status().unwrap();
    assert!(status.errors.iter().any(|entry|entry.prompt_id==edit.prompt_id && entry.code=="recovery_required"));
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn recovery_process_worker() {
    let Ok(directory) = std::env::var("PR0_RECOVERY_TEST_DIRECTORY") else { return; };
    let transport = approval();
    transport.0.lock().unwrap().pop();
    let data = replacement_fixture();
    transport.0.lock().unwrap().extend([
        json!({"fixtureFailure":"snapshot_required"}),
        data["manifest"].clone(), data["pages"][0].clone(), data["pages"][1].clone(), change_fixture()
    ]);
    let service = AuthService::new(directory.into(), transport, Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    service.library_changes(0).unwrap();
    for _ in 0..3 { service.library_download().unwrap(); }
}

#[test]
fn recovery_process_kill_keeps_atomic_staging_and_activation() {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    for stage in ["snapshot_page_commit", "snapshot_activation", "snapshot_activated"] {
        let (directory, service, _) = downloaded_change_fixture();
        let saved = service.library_create(save_request(&service)).unwrap();
        let pending = serde_json::to_value(service.library_pending().unwrap()).unwrap();
        drop(service);
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "auth_tests::recovery_process_worker", "--nocapture"])
            .env("PR0_RECOVERY_TEST_DIRECTORY", &directory)
            .env("PR0_LOCAL_TEST_PAUSE", stage)
            .stdout(Stdio::piped()).spawn().unwrap();
        let mut output = BufReader::new(child.stdout.take().unwrap());
        let mut line = String::new();
        loop {
            line.clear();
            assert!(output.read_line(&mut line).unwrap() > 0, "worker ended before {stage}");
            if line.trim() == format!("PAUSED:{stage}") { break; }
        }
        child.kill().unwrap();
        child.wait().unwrap();
        let service = AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
        assert_eq!(service.library_detail(&saved.prompt.id).unwrap().content, saved.prompt.content);
        assert_eq!(serde_json::to_value(service.library_pending().unwrap()).unwrap(), pending);
        let content = service.library_detail("66666666-6666-4666-8666-666666666666").unwrap().content;
        assert_eq!(content, if stage == "snapshot_activated" { "Remote content" } else { "  Hello offline\n" });
        assert_eq!(service.library_status().unwrap().complete, stage == "snapshot_activated");
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
