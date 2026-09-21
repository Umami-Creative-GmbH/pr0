// Exercise the typed service command boundary using real durable SQLite.
fn change_fixture() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/change-fixtures.json"
    ))
    .unwrap()
}
fn downloaded_change_fixture() -> (std::path::PathBuf, AuthService, Arc<Fixture>) {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let directory = std::env::temp_dir().join(format!("pr0-live-test-{}", uuid::Uuid::new_v4()));
    let transport = approval();
    transport.0.lock().unwrap().pop();
    transport.0.lock().unwrap().extend([
        data["manifest"].clone(),
        data["pages"][0].clone(),
        data["pages"][1].clone(),
    ]);
    let service = AuthService::new(
        directory.clone(),
        transport.clone(),
        Arc::new(Vault::default()),
    )
    .unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    service.library_download().unwrap();
    (directory, service, transport)
}

#[test]
fn live_changes_upgrade_usage_database_without_losing_pending_work() {
    let (directory, service, _) = downloaded_change_fixture();
    let id = "66666666-6666-4666-8666-666666666666";
    let prompt = service.library_detail(id).unwrap();
    service
        .library_copy(copy_request(&service, id), |_| Ok(()))
        .unwrap();
    let mut saved = save_request(&service);
    saved.desired.title = "Saved before upgrade".into();
    service.library_create(saved.clone()).unwrap();
    drop(service);
    let path =
        super::library_storage::library_path(&directory, &prompt.instance_id, &prompt.account_id)
            .unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    // Recreate main's version-4 schema with real downloaded and pending records.
    db.execute_batch("DROP VIEW visible_prompt; CREATE VIEW visible_prompt AS SELECT * FROM base_visible_prompt; DROP TABLE organization_known; DROP TABLE organization_checkpoint; DROP TABLE organization_ack; DROP TABLE organization_queue; DROP TABLE organization_local; DROP TABLE organization_receipt; DROP TABLE organization_removed; DROP TABLE organization_affected; DROP TABLE organization_assignment; DROP TABLE organization_membership_removal; DROP VIEW visible_prompt; DROP VIEW base_visible_prompt; CREATE VIEW visible_prompt AS SELECT id,title,archived,record,text_bytes FROM local_prompt UNION ALL SELECT id,title,archived,record,text_bytes FROM prompt WHERE snapshot=(SELECT active FROM state) AND id NOT IN(SELECT id FROM local_prompt); DROP TABLE recovery_state; DROP TABLE recovery_prompt; DROP TABLE recovery_work; DROP TABLE recovery_archive; DROP TABLE recovery_blocked; ALTER TABLE pending_usage DROP COLUMN recovery; DROP TABLE change_state; UPDATE upload_state SET last_checked='2026-09-21T10:00:00.000Z'; PRAGMA user_version=4;").unwrap();
    drop(db);
    let store = super::library_storage::LibraryStore::open(
        &directory,
        &prompt.instance_id,
        &prompt.account_id,
    )
    .unwrap();
    assert!(store.status().unwrap().complete);
    assert_eq!(store.detail(id).unwrap().content, prompt.content);
    assert_eq!(
        store.detail(&saved.prompt_id).unwrap().title,
        "Saved before upgrade"
    );
    assert_eq!(store.status().unwrap().pending_changes, 2);
    assert_eq!(store.usage_status().unwrap().waiting, 1);
    assert_eq!(store.recents(0).unwrap()[0].id, id);
    assert!(store.change_status().unwrap().last_checked_at.is_none());
    assert!(store.change_request(0).unwrap().is_some());
    drop(store);
    let db = rusqlite::Connection::open(path).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
            .unwrap(),
        7
    );
    drop(db);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn live_changes_before_usage_receipt_do_not_double_count_after_acknowledgement() {
    let (directory, service, _) = downloaded_change_fixture();
    let id = "66666666-6666-4666-8666-666666666666";
    let prompt = service.library_detail(id).unwrap();
    drop(service);
    let mut store = super::library_storage::LibraryStore::open(
        &directory,
        &prompt.instance_id,
        &prompt.account_id,
    )
    .unwrap();
    let usage = super::usage_contract::Usage {
        id: uuid::Uuid::new_v4().to_string(),
        prompt_id: id.into(),
        occurred_at: "2026-09-21T10:00:00.000Z".into(),
    };
    store.record_usage(&usage).unwrap();
    let (body, _) = store.prepare_usage().unwrap().unwrap();
    let mut page = change_fixture();
    page["changes"][0]["operationId"] = json!(usage.id);
    page["changes"][0]["prompts"][0]["useCount"] = json!(1);
    page["changes"][0]["prompts"][0]["lastUsedAt"] = json!(usage.occurred_at);
    store
        .apply_changes(serde_json::from_value(page).unwrap())
        .unwrap();
    let receipt = serde_json::from_value(json!({
        "operationId": usage.id, "promptId": id, "revision": "3",
        "acceptedAt": usage.occurred_at, "usedAt": usage.occurred_at,
        "conflict": null, "organizationNotice": null
    }))
    .unwrap();
    store
        .acknowledge_usage(&body, super::upload_contract::Outcome::Accepted(receipt))
        .unwrap();
    assert_eq!(store.usage_status().unwrap().awaiting_download, 0);
    assert_eq!(store.detail(id).unwrap().use_count, 1);
    assert_eq!(store.recents(0).unwrap()[0].id, id);
    drop(store);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn live_changes_reject_partial_pages_without_advancing_freshness_or_records() {
    let (directory, service, transport) = downloaded_change_fixture();
    let mut first = change_fixture();
    first["hasMore"] = json!(true);
    first["headRevision"] = json!("4");
    transport.0.lock().unwrap().push(first);
    let status = service.library_changes(0).unwrap();
    assert!(status.updating);
    assert!(status.last_checked_at.is_none());
    assert_eq!(
        service.library_status().unwrap().revision.as_deref(),
        Some("3")
    );
    let mut partial = change_fixture();
    partial["fromRevision"] = json!("3");
    partial["revision"] = json!("4");
    partial["headRevision"] = json!("4");
    partial["changes"] = json!([]);
    transport.0.lock().unwrap().push(partial);
    let status = service.library_changes(0).unwrap();
    assert_eq!(status.error.as_deref(), Some("invalid_response"));
    assert!(status.last_checked_at.is_none());
    assert_eq!(
        service.library_status().unwrap().revision.as_deref(),
        Some("3")
    );
    assert_eq!(
        service
            .library_detail("66666666-6666-4666-8666-666666666666")
            .unwrap()
            .content,
        "Remote content"
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn live_changes_apply_compact_tag_cleanup_and_deletion_atomically() {
    let (directory, service, transport) = downloaded_change_fixture();
    let mut assigned = change_fixture();
    let tag = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assigned["changes"][0]["prompts"][0]["tagIds"] = json!([tag]);
    assigned["changes"][0]["organization"]["tags"] = json!([{"id":tag,"name":"Writing","revision":"3","activeCount":1,"archivedCount":0,"totalCount":1}]);
    transport.0.lock().unwrap().push(assigned);
    assert!(service.library_changes(0).unwrap().error.is_none());
    let mut bulk = change_fixture();
    bulk["fromRevision"] = json!("3");
    bulk["revision"] = json!("4");
    bulk["headRevision"] = json!("4");
    bulk["changes"][0]["revision"] = json!("4");
    bulk["changes"][0]["organization"]["revision"] = json!("4");
    bulk["changes"][0]["prompts"] = json!([]);
    bulk["changes"][0]["effect"] = json!({"kind":"tag.delete","sourceId":tag,"sourceName":"Writing","targetId":null,"targetName":null,"activeCount":1,"archivedCount":0,"targetActiveCount":0,"targetArchivedCount":0});
    transport.0.lock().unwrap().push(bulk.clone());
    assert!(service.library_changes(0).unwrap().error.is_none());
    let prompt = service
        .library_detail("66666666-6666-4666-8666-666666666666")
        .unwrap();
    assert!(prompt.tag_ids.is_empty());
    assert_eq!(prompt.revision, "4");
    assert_eq!(prompt.modified_at, "2026-09-21T10:00:00.001Z");
    bulk["fromRevision"] = json!("4");
    bulk["revision"] = json!("5");
    bulk["headRevision"] = json!("5");
    bulk["changes"][0]["revision"] = json!("5");
    bulk["changes"][0]["organization"]["revision"] = json!("5");
    bulk["changes"][0]["effect"] = json!(null);
    bulk["changes"][0]["deletedPromptIds"] = json!([prompt.id]);
    transport.0.lock().unwrap().push(bulk);
    assert!(service.library_changes(0).unwrap().error.is_none());
    assert_eq!(service.library_status().unwrap().downloaded, 1);
    assert_eq!(
        service.library_detail(&prompt.id).err().as_deref(),
        Some("prompt_unavailable")
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn live_changes_allow_one_poll_and_reject_a_late_response_after_sign_out() {
    struct WaitingChange {
        fixture: Arc<Fixture>,
        entered: std::sync::Barrier,
        release: std::sync::Barrier,
    }
    impl Transport for WaitingChange {
        fn open_browser(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        fn request(
            &self,
            origin: &str,
            endpoint: Endpoint,
            token: Option<&str>,
            body: Option<serde_json::Value>,
        ) -> Result<serde_json::Value, String> {
            if matches!(endpoint, Endpoint::Changes) {
                self.entered.wait();
                self.release.wait();
                Ok(change_fixture())
            } else {
                self.fixture.request(origin, endpoint, token, body)
            }
        }
    }
    let (directory, initial, fixture) = downloaded_change_fixture();
    drop(initial);
    fixture.0.lock().unwrap().push(json!({"success":true}));
    let transport = Arc::new(WaitingChange {
        fixture,
        entered: std::sync::Barrier::new(2),
        release: std::sync::Barrier::new(2),
    });
    // Reauthenticate the retained partition through the same account before polling.
    transport.fixture.0.lock().unwrap().clear();
    transport.fixture.0.lock().unwrap().extend([
        fixtures()["capabilities"].clone(),
        fixtures()["code"].clone(),
        fixtures()["token"].clone(),
        fixtures()["session"].clone(),
        json!({"success":true}),
    ]);
    let service = Arc::new(
        AuthService::new(
            directory.clone(),
            transport.clone(),
            Arc::new(Vault::default()),
        )
        .unwrap(),
    );
    sign_in(&service);
    let worker = service.clone();
    let poll = std::thread::spawn(move || worker.library_changes(25));
    transport.entered.wait();
    assert_eq!(
        service.library_changes(0).err().as_deref(),
        Some("changes_in_progress")
    );
    service.sign_out().unwrap();
    transport.release.wait();
    assert_eq!(
        poll.join().unwrap().err().as_deref(),
        Some("operation_cancelled")
    );
    assert!(service.library_status().is_err());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn live_changes_preserve_saved_local_edits_and_replay_after_restart() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let change: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/change-fixtures.json"
    ))
    .unwrap();
    let directory = std::env::temp_dir().join(format!("pr0-live-{}", uuid::Uuid::new_v4()));
    let transport = approval();
    transport.0.lock().unwrap().pop();
    transport.0.lock().unwrap().extend([
        data["manifest"].clone(),
        data["pages"][0].clone(),
        data["pages"][1].clone(),
    ]);
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    service.library_download().unwrap();
    let id = "66666666-6666-4666-8666-666666666666";
    let original = service.library_editor(id).unwrap();
    let mut request = save_request(&service);
    request.prompt_id = id.into();
    request.expected_local_revision = Some(original.local_revision);
    request.desired.content = "My saved local successor".into();
    service.library_edit(request).unwrap();
    transport.0.lock().unwrap().push(change.clone());
    service.library_changes(0).unwrap();
    assert_eq!(
        service.library_editor(id).unwrap().prompt.content,
        "My saved local successor"
    );
    assert_eq!(
        service.library_status().unwrap().revision.as_deref(),
        Some("3")
    );
    assert_eq!(service.library_status().unwrap().pending_changes, 1);
    transport.0.lock().unwrap().push(change);
    service.library_changes(0).unwrap();
    assert_eq!(service.library_status().unwrap().pending_changes, 1);
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(
        reopened.library_editor(id).unwrap().prompt.content,
        "My saved local successor"
    );
    assert_eq!(
        reopened.library_status().unwrap().revision.as_deref(),
        Some("3")
    );
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}
