// Public typed commands over durable SQLite; HTTPS is the controlled external boundary.
#[test]
fn lifecycle_recovery_includes_deletions_beyond_the_first_hundred_prompts() {
    let directory = std::env::temp_dir().join(format!("pr0-pending-list-{}", uuid::Uuid::new_v4()));
    let service = downloaded_upload_service(&directory, upload_fixture(false, false), Arc::new(Vault::default()));
    for _ in 0..101 {
        let mut request = save_request(&service);
        request.prompt_id = uuid::Uuid::new_v4().to_string();
        request.operation_id = uuid::Uuid::new_v4().to_string();
        service.library_create(request.clone()).unwrap();
        service.library_lifecycle(lifecycle_request(&service,&request.prompt_id,json!({"kind":"delete","confirmed":true}))).unwrap();
    }
    let pending = service.library_upload_status().unwrap().pending;
    assert_eq!(pending.len(),101);
    assert!(pending.iter().all(|entry| entry.deleting));
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_source_edit_preserves_the_creation_dependency_of_an_offline_copy() {
    let directory = std::env::temp_dir().join(format!("pr0-copy-dependency-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(false, false);
    let service = downloaded_upload_service(&directory, transport.clone(), Arc::new(Vault::default()));
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    let copy_id = uuid::Uuid::new_v4().to_string();
    service.library_lifecycle(lifecycle_request(&service, &request.prompt_id, json!({"kind":"duplicate","copyId":copy_id}))).unwrap();
    let mut edit = request.clone();
    edit.operation_id = uuid::Uuid::new_v4().to_string();
    edit.expected_local_revision = Some(service.library_editor(&request.prompt_id).unwrap().local_revision);
    edit.desired.content = "Later source text".into();
    service.library_edit(edit).unwrap();
    for _ in 0..3 {
        service.library_upload().unwrap();
    }
    let traffic = transport.traffic.lock().unwrap();
    assert_eq!(traffic.len(), 3);
    assert_eq!(traffic[0].1["operations"][0]["operationId"], request.operation_id);
    assert_eq!(traffic[1].1["operations"][0]["dependsOn"], json!([request.operation_id]));
    assert_eq!(traffic[1].1["operations"][0]["desired"]["content"], request.desired.content);
    assert_eq!(service.library_detail(&copy_id).unwrap().content, request.desired.content);
    drop(traffic);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_discard_refuses_to_orphan_a_dependent_copy() {
    let directory = std::env::temp_dir().join(format!("pr0-copy-discard-{}", uuid::Uuid::new_v4()));
    let service = downloaded_upload_service(&directory, upload_fixture(false, false), Arc::new(Vault::default()));
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    let copy_id = uuid::Uuid::new_v4().to_string();
    service.library_lifecycle(lifecycle_request(&service, &request.prompt_id, json!({"kind":"duplicate","copyId":copy_id}))).unwrap();
    let mut recovery = super::lifecycle_contract::RecoveryRequest {
        instance_id: request.instance_id, account_id: request.account_id, generation: request.generation,
        prompt_id: request.prompt_id.clone(), action: super::lifecycle_contract::RecoveryAction::Discard, confirmed: true,
    };
    assert_eq!(service.library_recover(recovery.clone()).err().as_deref(), Some("dependent_changes_pending"));
    assert_eq!(service.library_retained_prompt(&copy_id).unwrap().content, request.desired.content);
    assert_eq!(service.library_status().unwrap().pending_changes, 2);
    recovery.prompt_id = copy_id;
    service.library_recover(recovery.clone()).unwrap();
    recovery.prompt_id = request.prompt_id;
    service.library_recover(recovery).unwrap();
    assert_eq!(service.library_status().unwrap().pending_changes, 0);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

fn lifecycle_request(
    service: &AuthService,
    id: &str,
    action: serde_json::Value,
) -> super::lifecycle_contract::LifecycleRequest {
    let request = save_request(service);
    serde_json::from_value(json!({
        "instanceId":request.instance_id,"accountId":request.account_id,
        "generation":request.generation,"operationId":uuid::Uuid::new_v4().to_string(),
        "promptId":id,"expectedLocalRevision":service.library_editor(id).unwrap().local_revision,
        "action":action
    }))
    .unwrap()
}

#[test]
fn lifecycle_archived_favorite_survives_restart_and_restores() {
    let directory = std::env::temp_dir().join(format!("pr0-lifecycle-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let transport = upload_fixture(false, false);
    let service = downloaded_upload_service(&directory, transport.clone(), vault.clone());
    let id = "66666666-6666-4666-8666-666666666666";
    let before = service.library_detail(id).unwrap();
    service
        .library_lifecycle(lifecycle_request(
            &service,
            id,
            json!({"kind":"favorite","value":true}),
        ))
        .unwrap();
    service
        .library_lifecycle(lifecycle_request(
            &service,
            id,
            json!({"kind":"archive","value":true}),
        ))
        .unwrap();
    assert!(!service
        .library_browse(0)
        .unwrap()
        .iter()
        .any(|row| row.id == id));
    drop(service);
    let service = AuthService::new(directory.clone(), transport, vault).unwrap();
    let archived = service.library_detail(id).unwrap();
    assert!(archived.archived && archived.favorite);
    assert_eq!(archived.content, before.content);
    assert_eq!(archived.tag_ids, before.tag_ids);
    assert_eq!(archived.collection_id, before.collection_id);
    service
        .library_lifecycle(lifecycle_request(
            &service,
            id,
            json!({"kind":"archive","value":false}),
        ))
        .unwrap();
    assert!(service
        .library_browse(0)
        .unwrap()
        .iter()
        .any(|row| row.id == id));
    assert!(service.library_detail(id).unwrap().favorite);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_metadata_and_later_text_reconnect_as_independent_intents() {
    let directory =
        std::env::temp_dir().join(format!("pr0-lifecycle-wire-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(false, false);
    let service =
        downloaded_upload_service(&directory, transport.clone(), Arc::new(Vault::default()));
    let id = "66666666-6666-4666-8666-666666666666";
    service
        .library_lifecycle(lifecycle_request(
            &service,
            id,
            json!({"kind":"favorite","value":true}),
        ))
        .unwrap();
    service
        .library_lifecycle(lifecycle_request(
            &service,
            id,
            json!({"kind":"archive","value":true}),
        ))
        .unwrap();
    let mut edit = save_request(&service);
    edit.prompt_id = id.into();
    edit.expected_local_revision = Some(service.library_editor(id).unwrap().local_revision);
    edit.desired.content = "Later archived edit".into();
    service.library_edit(edit).unwrap();
    for _ in 0..3 {
        assert!(service.library_upload().unwrap().error.is_none());
    }
    let traffic = transport.traffic.lock().unwrap();
    let operations: Vec<_> = traffic
        .iter()
        .map(|(_, body)| &body["operations"][0])
        .collect();
    assert_eq!(operations.len(), 3);
    assert_eq!(operations[0]["changedFields"], json!(["favorite"]));
    assert_eq!(operations[0]["desired"]["favorite"], true);
    assert_eq!(operations[1]["changedFields"], json!(["archived"]));
    assert_eq!(operations[1]["desired"]["archived"], true);
    assert_eq!(operations[2]["desired"]["content"], "Later archived edit");
    assert!(operations.iter().all(|op| op.get("metadata").is_none()));
    let prompt = service.library_detail(id).unwrap();
    assert!(prompt.favorite && prompt.archived);
    assert_eq!(prompt.content, "Later archived edit");
    drop(traffic);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_duplicate_freezes_selected_archived_snapshot_with_new_identity() {
    let directory = std::env::temp_dir().join(format!("pr0-duplicate-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(false, false);
    let service =
        downloaded_upload_service(&directory, transport.clone(), Arc::new(Vault::default()));
    let id = "66666666-6666-4666-8666-666666666666";
    service
        .library_lifecycle(lifecycle_request(
            &service,
            id,
            json!({"kind":"favorite","value":true}),
        ))
        .unwrap();
    service
        .library_lifecycle(lifecycle_request(
            &service,
            id,
            json!({"kind":"archive","value":true}),
        ))
        .unwrap();
    let original = service.library_detail(id).unwrap();
    let copy_id = uuid::Uuid::new_v4().to_string();
    let request = lifecycle_request(&service, id, json!({"kind":"duplicate","copyId":copy_id}));
    service.library_lifecycle(request.clone()).unwrap();
    service.library_lifecycle(request).unwrap();
    let copy = service.library_detail(&copy_id).unwrap();
    assert_eq!(copy.title, format!("{} (copy)", original.title));
    assert_eq!(copy.content, original.content);
    assert_eq!(copy.tag_ids, original.tag_ids);
    assert_eq!(copy.collection_id, original.collection_id);
    assert!(!copy.archived && !copy.favorite);
    assert_eq!(copy.use_count, 0);
    assert!(copy.last_used_at.is_none());
    let mut edit = save_request(&service);
    edit.prompt_id = id.into();
    edit.expected_local_revision = Some(service.library_editor(id).unwrap().local_revision);
    edit.desired.content = "Changed source".into();
    service.library_edit(edit).unwrap();
    for _ in 0..4 {
        assert!(service.library_upload().unwrap().error.is_none());
    }
    let traffic = transport.traffic.lock().unwrap();
    let copy_operation = traffic
        .iter()
        .map(|(_, body)| &body["operations"][0])
        .find(|op| op["kind"] == "prompt.duplicate")
        .unwrap();
    assert_eq!(copy_operation["sourceId"], id);
    assert_eq!(copy_operation["desired"]["content"], original.content);
    assert_eq!(copy_operation["desired"]["tagIds"], json!(original.tag_ids));
    assert_eq!(
        service.library_detail(&copy_id).unwrap().content,
        original.content
    );
    drop(traffic);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_confirmed_deletion_stays_hidden_after_restart_and_stale_delete_receipt() {
    let directory = std::env::temp_dir().join(format!("pr0-delete-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(true, false);
    let vault = Arc::new(Vault::default());
    let service = downloaded_upload_service(&directory, transport.clone(), vault.clone());
    let id = "66666666-6666-4666-8666-666666666666";
    let request = lifecycle_request(&service, id, json!({"kind":"delete","confirmed":true}));
    service.library_lifecycle(request.clone()).unwrap();
    assert!(service.library_detail(id).is_err());
    drop(service);
    let service = AuthService::new(directory.clone(), transport.clone(), vault).unwrap();
    let mut request = request;
    request.generation = save_request(&service).generation;
    service.library_lifecycle(request).unwrap();
    assert!(service.library_detail(id).is_err());
    let status = service.library_upload().unwrap();
    assert!(status.error.is_none());
    assert_eq!(status.awaiting_download, 1);
    // A stale delete preserves the unseen SERVER variant. Never invent its text
    // from the older local prompt or retarget an editor to that different variant.
    assert!(status.mappings.is_empty());
    assert!(service.library_detail(id).is_err());
    assert!(service
        .library_detail("99999999-9999-4999-8999-999999999999")
        .is_err());
    let traffic = transport.traffic.lock().unwrap();
    assert_eq!(traffic[0].1["operations"][0]["kind"], "prompt.delete");
    assert!(traffic[0].1["operations"][0].get("desired").is_none());
    drop(traffic);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_discard_cannot_claim_to_undo_uncertain_delivery() {
    let directory = std::env::temp_dir().join(format!("pr0-discard-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(false, false);
    let service =
        downloaded_upload_service(&directory, transport.clone(), Arc::new(Vault::default()));
    let id = "66666666-6666-4666-8666-666666666666";
    let action = lifecycle_request(&service, id, json!({"kind":"delete","confirmed":true}));
    service.library_lifecycle(action.clone()).unwrap();
    transport
        .lose
        .store(true, std::sync::atomic::Ordering::SeqCst);
    service.library_upload().unwrap();
    let mut recovery:super::lifecycle_contract::RecoveryRequest = serde_json::from_value(json!({
        "instanceId":action.instance_id,"accountId":action.account_id,"generation":action.generation,
        "promptId":id,"action":"discard","confirmed":true
    })).unwrap();
    assert_eq!(
        service.library_recover(recovery.clone()).err().as_deref(),
        Some("delivery_uncertain")
    );
    assert_eq!(service.library_upload_status().unwrap().waiting, 1);
    recovery.action = super::lifecycle_contract::RecoveryAction::Retry;
    service.library_recover(recovery.clone()).unwrap();
    assert_eq!(service.library_upload().unwrap().awaiting_download, 1);
    recovery.action = super::lifecycle_contract::RecoveryAction::Discard;
    assert_eq!(
        service.library_recover(recovery).err().as_deref(),
        Some("accepted_effect_pending_download")
    );
    assert!(service.library_detail(id).is_err());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_incoming_text_preserves_pending_favorite_and_archive() {
    let (directory, service, transport) = downloaded_change_fixture();
    let id = "66666666-6666-4666-8666-666666666666";
    service
        .library_lifecycle(lifecycle_request(
            &service,
            id,
            json!({"kind":"favorite","value":true}),
        ))
        .unwrap();
    service
        .library_lifecycle(lifecycle_request(
            &service,
            id,
            json!({"kind":"archive","value":true}),
        ))
        .unwrap();
    let change = change_fixture();
    transport.0.lock().unwrap().push(change.clone());
    service.library_changes(0).unwrap();
    let prompt = service.library_detail(id).unwrap();
    assert!(prompt.favorite && prompt.archived);
    assert_eq!(
        prompt.content,
        change["changes"][0]["prompts"][0]["content"]
            .as_str()
            .unwrap()
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_conflict_copy_keeps_all_successor_actions_on_the_preserved_variant() {
    let directory = std::env::temp_dir().join(format!("pr0-successors-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(true, false);
    let service =
        downloaded_upload_service(&directory, transport.clone(), Arc::new(Vault::default()));
    let id = "66666666-6666-4666-8666-666666666666";
    let mut edit = save_request(&service);
    edit.prompt_id = id.into();
    edit.expected_local_revision = Some(service.library_editor(id).unwrap().local_revision);
    service.library_edit(edit.clone()).unwrap();
    service
        .library_lifecycle(lifecycle_request(
            &service,
            id,
            json!({"kind":"favorite","value":true}),
        ))
        .unwrap();
    service
        .library_lifecycle(lifecycle_request(
            &service,
            id,
            json!({"kind":"archive","value":true}),
        ))
        .unwrap();
    edit.operation_id = uuid::Uuid::new_v4().to_string();
    edit.expected_local_revision = Some(service.library_editor(id).unwrap().local_revision);
    edit.desired.content = "Successor on copy".into();
    service.library_edit(edit).unwrap();
    for _ in 0..4 {
        assert!(service.library_upload().unwrap().error.is_none());
    }
    let copy = service
        .library_detail("99999999-9999-4999-8999-999999999999")
        .unwrap();
    assert!(copy.favorite && copy.archived);
    assert_eq!(copy.content, "Successor on copy");
    assert_eq!(service.library_upload_status().unwrap().waiting, 0);
    let traffic = transport.traffic.lock().unwrap();
    assert!(traffic.iter().skip(1).all(
        |(_, body)| body["operations"][0]["promptId"] == "99999999-9999-4999-8999-999999999999"
    ));
    drop(traffic);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_refused_deletion_retains_original_text_and_can_explicitly_discard() {
    let directory =
        std::env::temp_dir().join(format!("pr0-refused-delete-{}", uuid::Uuid::new_v4()));
    let service = downloaded_upload_service(
        &directory,
        upload_fixture(false, true),
        Arc::new(Vault::default()),
    );
    let id = "66666666-6666-4666-8666-666666666666";
    let original = service.library_detail(id).unwrap();
    let request = lifecycle_request(&service, id, json!({"kind":"delete","confirmed":true}));
    let mut cancelled = request.clone();
    cancelled.action = super::lifecycle_contract::LifecycleAction::Delete { confirmed: false };
    assert_eq!(
        service.library_lifecycle(cancelled).err().as_deref(),
        Some("confirmation_required")
    );
    assert_eq!(service.library_status().unwrap().pending_changes, 0);
    service.library_lifecycle(request.clone()).unwrap();
    let status = service.library_upload().unwrap();
    assert_eq!(status.waiting, 1);
    assert_eq!(status.errors[0].code, "quota_exceeded");
    assert_eq!(
        service.library_retained_prompt(id).unwrap().content,
        original.content
    );
    service
        .library_recover(super::lifecycle_contract::RecoveryRequest {
            instance_id: request.instance_id,
            account_id: request.account_id,
            generation: request.generation,
            prompt_id: id.into(),
            action: super::lifecycle_contract::RecoveryAction::Discard,
            confirmed: true,
        })
        .unwrap();
    assert_eq!(
        service.library_detail(id).unwrap().content,
        original.content
    );
    assert_eq!(service.library_status().unwrap().pending_changes, 0);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_duplicate_uses_shared_rest_title_and_retention_fixtures() {
    let fixtures: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/duplicate-prompt-fixtures.json"
    ))
    .unwrap();
    for fixture in fixtures {
        let directory =
            std::env::temp_dir().join(format!("pr0-copy-fixture-{}", uuid::Uuid::new_v4()));
        let transport = upload_fixture(false, false);
        let service =
            downloaded_upload_service(&directory, transport.clone(), Arc::new(Vault::default()));
        let mut request = save_request(&service);
        request.desired=serde_json::from_value(json!({"title":fixture["sourceTitle"],"description":fixture["description"],"content":fixture["content"]})).unwrap();
        service.library_create(request.clone()).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        service
            .library_lifecycle(lifecycle_request(
                &service,
                &request.prompt_id,
                json!({"kind":"duplicate","copyId":id}),
            ))
            .unwrap();
        let copy = service.library_detail(&id).unwrap();
        assert_eq!(copy.title, fixture["title"].as_str().unwrap());
        assert_eq!(
            copy.source_title.as_deref(),
            fixture["sourceTitle"].as_str()
        );
        service.library_upload().unwrap();
        service.library_upload().unwrap();
        let traffic = transport.traffic.lock().unwrap();
        assert_eq!(
            traffic[1].1["operations"][0]["desired"]["title"],
            fixture["sourceTitle"]
        );
        drop(traffic);
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[test]
fn lifecycle_failed_local_action_rolls_back_and_retries_without_losing_source() {
    let (directory, service, _) = downloaded_change_fixture();
    let id = "66666666-6666-4666-8666-666666666666";
    let original = service.library_detail(id).unwrap();
    let request = lifecycle_request(&service, id, json!({"kind":"delete","confirmed":true}));
    super::library_storage::set_test_fault("io_error");
    let result = service.library_lifecycle(request.clone());
    super::library_storage::set_test_fault("");
    assert_eq!(result.err().as_deref(), Some("storage_unavailable"));
    assert_eq!(
        service.library_detail(id).unwrap().content,
        original.content
    );
    assert_eq!(service.library_status().unwrap().pending_changes, 0);
    service.library_lifecycle(request).unwrap();
    assert!(service.library_detail(id).is_err());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
