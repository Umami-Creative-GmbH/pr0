// Typed native commands over real SQLite; transport is the external server boundary.
#[test]
fn offline_organization_unrelated_receipt_cannot_observe_a_tag_removal() {
    let (directory, service, transport) = downloaded_change_fixture();
    let tag = uuid::Uuid::new_v4().to_string();
    let prompt = "66666666-6666-4666-8666-666666666666";
    let mut page = change_fixture();
    page["changes"][0]["organization"]["tags"] = json!([{"id":tag,"name":"Writing","revision":"3","activeCount":0,"archivedCount":0,"totalCount":0}]);
    page["changes"][0]["prompts"] = json!([]);
    transport.0.lock().unwrap().push(page);
    service.library_changes(0).unwrap();
    let unrelated = organization_request(
        &service,
        json!({"kind":"prompt.collection","id":prompt,"collectionId":null}),
    );
    let unrelated_id = unrelated.operation_id.clone();
    service.library_organize(unrelated).unwrap();
    let add = organization_request(
        &service,
        json!({"kind":"prompt.tags","id":prompt,"add":[tag],"remove":[]}),
    );
    let add_id = add.operation_id.clone();
    service.library_organize(add).unwrap();
    for (operation, revision) in [(&unrelated_id, "20"), (&add_id, "21")] {
        transport.0.lock().unwrap().extend([fixtures()["capabilities"].clone(),fixtures()["session"].clone(),json!({"results":[{"status":"accepted","operationId":operation,"promptId":prompt,"revision":revision,"acceptedAt":"2026-09-20T00:00:00.000Z"}]})]);
        assert!(service.library_upload().unwrap().error.is_none());
    }
    let snapshot = service.library_organization().unwrap();
    let addition = snapshot["pending"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == add_id)
        .unwrap();
    assert_eq!(addition["operation"]["baseRevision"], "3");
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_organization_corrected_creation_reuses_identity_and_releases_dependants() {
    let (directory, service, transport) = downloaded_change_fixture();
    let existing = uuid::Uuid::new_v4().to_string();
    let created = uuid::Uuid::new_v4().to_string();
    let prompt = "66666666-6666-4666-8666-666666666666";
    let mut page = change_fixture();
    page["changes"][0]["organization"]["tags"] = json!([{"id":existing,"name":"Writing","revision":"3","activeCount":0,"archivedCount":0,"totalCount":0}]);
    page["changes"][0]["prompts"] = json!([]);
    transport.0.lock().unwrap().push(page);
    service.library_changes(0).unwrap();
    let create = organization_request(
        &service,
        json!({"kind":"tag.create","id":created,"name":"Draft"}),
    );
    let rejected = create.operation_id.clone();
    service.library_organize(create).unwrap();
    let mut renames = vec![];
    for name in ["Draft one", "Draft two"] {
        let rename = organization_request(
            &service,
            json!({"kind":"tag.rename","id":created,"name":name}),
        );
        renames.push(rename.operation_id.clone());
        service.library_organize(rename).unwrap();
    }
    let assign = organization_request(
        &service,
        json!({"kind":"prompt.tags","id":prompt,"add":[created],"remove":[]}),
    );
    let assignment = assign.operation_id.clone();
    service.library_organize(assign).unwrap();
    transport.0.lock().unwrap().extend([fixtures()["capabilities"].clone(),fixtures()["session"].clone(),json!({"results":[{"status":"rejected","error":{"operationId":rejected,"code":"quota_exceeded","message":"Full","retryable":false}}]})]);
    service.library_upload().unwrap();
    let mut correction = organization_request(
        &service,
        json!({"kind":"tag.create","id":created,"name":"Writing"}),
    );
    correction.replaces = Some(rejected.clone());
    assert_eq!(
        service.library_organize(correction).unwrap()["id"],
        existing
    );
    assert_eq!(
        service.library_detail(prompt).unwrap().tag_ids,
        vec![existing.clone()]
    );
    let snapshot = service.library_organization().unwrap();
    assert_eq!(snapshot["pending"].as_array().unwrap().len(), 3);
    assert!(!snapshot["pending"][0]["operation"]["dependsOn"]
        .as_array()
        .unwrap()
        .contains(&json!(rejected)));
    for operation in renames {
        transport.0.lock().unwrap().extend([fixtures()["capabilities"].clone(),fixtures()["session"].clone(),json!({"results":[{"status":"accepted","operationId":operation,"tagId":existing,"resolvedTagId":existing,"outcome":"renamed","revision":"4","acceptedAt":"2026-09-20T00:00:00.000Z"}]})]);
        assert!(service.library_upload().unwrap().error.is_none());
    }
    transport.0.lock().unwrap().extend([fixtures()["capabilities"].clone(),fixtures()["session"].clone(),json!({"results":[{"status":"accepted","operationId":assignment,"promptId":prompt,"revision":"4","acceptedAt":"2026-09-20T00:00:00.000Z"}]})]);
    assert_eq!(service.library_upload().unwrap().waiting, 0);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_organization_rejected_cleanup_previews_without_discarding_saved_intent() {
    let (directory, service, transport) = downloaded_change_fixture();
    let tag = uuid::Uuid::new_v4().to_string();
    let mut page = change_fixture();
    page["changes"][0]["organization"]["tags"] = json!([{"id":tag,"name":"Writing","revision":"3","activeCount":0,"archivedCount":0,"totalCount":0}]);
    page["changes"][0]["prompts"] = json!([]);
    transport.0.lock().unwrap().push(page);
    service.library_changes(0).unwrap();
    let request = organization_request(&service, json!({"kind":"tag.delete","id":tag}));
    let rejected = request.operation_id.clone();
    let action = request.action.clone();
    service.library_organize(request).unwrap();
    transport.0.lock().unwrap().extend([fixtures()["capabilities"].clone(),fixtures()["session"].clone(),json!({"results":[{"status":"rejected","error":{"operationId":rejected,"code":"results_changed","message":"Review again","retryable":true}}]})]);
    service.library_upload().unwrap();
    let preview = service
        .library_organization_impact(action.clone(), Some(rejected.clone()))
        .unwrap();
    assert_eq!(preview["effect"]["sourceName"], "Writing");
    assert!(service.library_organization().unwrap()["tags"]
        .as_array()
        .unwrap()
        .is_empty());
    let mut correction = organization_request(&service, serde_json::to_value(action).unwrap());
    correction.replaces = Some(rejected.clone());
    service.library_organize(correction).unwrap();
    let pending = service.library_organization().unwrap();
    assert_eq!(pending["pending"].as_array().unwrap().len(), 1);
    assert_ne!(pending["pending"][0]["id"], rejected);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_organization_shared_unicode_identity_fixtures() {
    let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/organization-native-fixtures.json"
    ))
    .unwrap();
    let directory = std::env::temp_dir().join(format!("pr0-org-unicode-{}", uuid::Uuid::new_v4()));
    let service =
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    for case in cases {
        let first=service.library_organize(organization_request(&service,json!({"kind":"tag.create","id":uuid::Uuid::new_v4().to_string(),"name":case["first"]}))).unwrap();
        let second=service.library_organize(organization_request(&service,json!({"kind":"tag.create","id":uuid::Uuid::new_v4().to_string(),"name":case["second"]}))).unwrap();
        assert_eq!(first["id"] == second["id"], case["same"].as_bool().unwrap());
    }
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_organization_capacity_and_snapshot_reconciliation_are_bounded() {
    use sha2::{Digest, Sha256};
    let directory = std::env::temp_dir().join(format!("pr0-org-capacity-{}", uuid::Uuid::new_v4()));
    let mut data = organization_capacity_data();
    let records: serde_json::Value =
        serde_json::from_str(data["pages"][0]["payload"].as_str().unwrap()).unwrap();
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
    let snapshot = service.library_organization().unwrap();
    assert_eq!(snapshot["collections"].as_array().unwrap().len(), 200);
    assert_eq!(snapshot["tags"].as_array().unwrap().len(), 1000);
    for (kind, code) in [
        ("collection.create", "quota_collection"),
        ("tag.create", "quota_tag"),
    ] {
        assert_eq!(service.library_organize(organization_request(&service,json!({"kind":kind,"id":uuid::Uuid::new_v4().to_string(),"name":"Beyond capacity"}))).err().as_deref(),Some(code));
    }
    let source = records["organization"]["tags"][0]["id"].as_str().unwrap();
    let target = records["organization"]["tags"][999]["id"].as_str().unwrap();
    let prompt = "66666666-6666-4666-8666-666666666666";
    service
        .library_organize(organization_request(
            &service,
            json!({"kind":"prompt.tags","id":prompt,"add":[source],"remove":[]}),
        ))
        .unwrap();
    // Replace the downloaded cut after a remote merge; no live effect was received.
    let mut replacement = records.clone();
    replacement["organization"]["tags"]
        .as_array_mut()
        .unwrap()
        .remove(0);
    replacement["organization"]["revision"] = json!("3");
    let payload = replacement.to_string();
    let snapshot_id = uuid::Uuid::new_v4().to_string();
    data["manifest"]["id"] = json!(snapshot_id);
    data["manifest"]["revision"] = json!("3");
    data["manifest"]["pages"][0]["bytes"] = json!(payload.len());
    data["manifest"]["pages"][0]["digest"] =
        json!(format!("{:x}", Sha256::digest(payload.as_bytes())));
    data["pages"][0]["payload"] = json!(payload);
    for page in data["pages"].as_array_mut().unwrap() {
        page["id"] = json!(snapshot_id);
    }
    transport.0.lock().unwrap().extend([
        data["manifest"].clone(),
        data["pages"][0].clone(),
        data["pages"][1].clone(),
    ]);
    service.library_download().unwrap();
    service.library_download().unwrap();
    let metadata = json!({"instanceId":data["manifest"]["instanceId"],"accountId":data["manifest"]["accountId"],"revision":"3","states":[{"id":source,"entity":"tag","name":"Tag 0000","state":"merged","targetId":target,"targetName":"Tag 0999"}],"removals":[]});
    transport
        .0
        .lock()
        .unwrap()
        .extend([metadata.clone(), metadata]);
    service.library_reconcile().unwrap();
    assert_eq!(
        service.library_detail(prompt).unwrap().tag_ids,
        vec![target.to_string()]
    );
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(
        reopened.library_detail(prompt).unwrap().tag_ids,
        vec![target.to_string()]
    );
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_organization_deliberate_readd_observes_accepted_removal() {
    let (directory, service, transport) = downloaded_change_fixture();
    let tag = uuid::Uuid::new_v4().to_string();
    let mut page = change_fixture();
    page["changes"][0]["organization"]["tags"] = json!([{"id":tag,"name":"Writing","revision":"3","activeCount":0,"archivedCount":0,"totalCount":0}]);
    page["changes"][0]["prompts"] = json!([]);
    transport.0.lock().unwrap().push(page);
    service.library_changes(0).unwrap();
    let prompt = "66666666-6666-4666-8666-666666666666";
    let remove = organization_request(
        &service,
        json!({"kind":"prompt.tags","id":prompt,"add":[],"remove":[tag]}),
    );
    let remove_id = remove.operation_id.clone();
    service.library_organize(remove).unwrap();
    let add = organization_request(
        &service,
        json!({"kind":"prompt.tags","id":prompt,"add":[tag],"remove":[]}),
    );
    let add_id = add.operation_id.clone();
    service.library_organize(add).unwrap();
    for (operation, revision) in [(&remove_id, "4"), (&add_id, "5")] {
        transport.0.lock().unwrap().extend([fixtures()["capabilities"].clone(),fixtures()["session"].clone(),json!({"results":[{"status":"accepted","operationId":operation,"promptId":prompt,"revision":revision,"acceptedAt":"2026-09-20T00:00:00.000Z"}]})]);
        assert!(service.library_upload().unwrap().error.is_none());
    }
    let snapshot = service.library_organization().unwrap();
    let readd = snapshot["pending"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == add_id)
        .unwrap();
    assert_eq!(readd["operation"]["baseRevision"], "4");
    assert_eq!(service.library_detail(prompt).unwrap().tag_ids, vec![tag]);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_organization_noop_remote_removal_invalidates_old_add() {
    let (directory, service, transport) = downloaded_change_fixture();
    let tag = uuid::Uuid::new_v4().to_string();
    let entry = json!({"id":tag,"name":"Writing","revision":"3","activeCount":0,"archivedCount":0,"totalCount":0});
    let mut page = change_fixture();
    page["changes"][0]["organization"]["tags"] = json!([entry]);
    page["changes"][0]["prompts"] = json!([]);
    transport.0.lock().unwrap().push(page);
    service.library_changes(0).unwrap();
    let prompt = "66666666-6666-4666-8666-666666666666";
    service
        .library_organize(organization_request(
            &service,
            json!({"kind":"prompt.tags","id":prompt,"add":[tag],"remove":[]}),
        ))
        .unwrap();
    let mut page = change_fixture();
    page["fromRevision"] = json!("3");
    page["revision"] = json!("4");
    page["headRevision"] = json!("4");
    page["changes"][0]["revision"] = json!("4");
    page["changes"][0]["organization"]["revision"] = json!("4");
    page["changes"][0]["organization"]["tags"] = json!([entry]);
    page["changes"][0]["prompts"] = json!([]);
    page["changes"][0]["removedMemberships"] = json!([{"promptId":prompt,"tagId":tag}]);
    transport.0.lock().unwrap().push(page);
    assert!(service.library_changes(0).unwrap().error.is_none());
    assert!(service.library_detail(prompt).unwrap().tag_ids.is_empty());
    service
        .library_organize(organization_request(
            &service,
            json!({"kind":"prompt.tags","id":prompt,"add":[tag],"remove":[]}),
        ))
        .unwrap();
    assert_eq!(service.library_detail(prompt).unwrap().tag_ids, vec![tag]);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_organization_assignment_dependencies_survive_prompt_coalescing() {
    let directory =
        std::env::temp_dir().join(format!("pr0-org-dependency-{}", uuid::Uuid::new_v4()));
    let service =
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    let mut create = save_request(&service);
    let original = create.operation_id.clone();
    let prompt = service.library_create(create.clone()).unwrap();
    let tag = uuid::Uuid::new_v4().to_string();
    let tag_request = organization_request(
        &service,
        json!({"kind":"tag.create","id":tag,"name":"Writing"}),
    );
    let dependency = tag_request.operation_id.clone();
    service.library_organize(tag_request).unwrap();
    service
        .library_organize(organization_request(
            &service,
            json!({"kind":"prompt.tags","id":prompt.prompt.id,"add":[tag],"remove":[]}),
        ))
        .unwrap();
    create.operation_id = uuid::Uuid::new_v4().to_string();
    create.expected_local_revision = Some(
        service
            .library_editor(&prompt.prompt.id)
            .unwrap()
            .local_revision,
    );
    create.desired.title = "Revised draft".into();
    service.library_edit(create.clone()).unwrap();
    let pending = serde_json::to_value(service.library_pending().unwrap()).unwrap();
    assert!(pending.to_string().contains(&dependency));
    let snapshot = service.library_organization().unwrap();
    let assignment = &snapshot["pending"][1]["operation"]["dependsOn"];
    assert!(assignment
        .as_array()
        .unwrap()
        .contains(&json!(create.operation_id)));
    assert!(!assignment.as_array().unwrap().contains(&json!(original)));
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_pending_assignment_follows_remote_alias_chain_until_target_deletion() {
    let (directory, service, transport) = downloaded_change_fixture();
    let source = uuid::Uuid::new_v4().to_string();
    let target = uuid::Uuid::new_v4().to_string();
    let last = uuid::Uuid::new_v4().to_string();
    let entry = |id: &str, name: &str| json!({"id":id,"name":name,"revision":"3","activeCount":0,"archivedCount":0,"totalCount":0});
    let mut page = change_fixture();
    page["changes"][0]["organization"]["tags"] = json!([
        entry(&source, "Draft"),
        entry(&target, "Writing"),
        entry(&last, "Final")
    ]);
    page["changes"][0]["prompts"] = json!([]);
    transport.0.lock().unwrap().push(page);
    assert!(service.library_changes(0).unwrap().error.is_none());
    let prompt = "66666666-6666-4666-8666-666666666666";
    service
        .library_organize(organization_request(
            &service,
            json!({"kind":"prompt.tags","id":prompt,"add":[source],"remove":[]}),
        ))
        .unwrap();
    for (revision, source_id, target_id, source_name, target_name) in [
        (4, &source, Some(&target), "Draft", Some("Writing")),
        (5, &target, Some(&last), "Writing", Some("Final")),
        (6, &last, None, "Final", None),
    ] {
        let mut page = change_fixture();
        page["fromRevision"] = json!((revision - 1).to_string());
        page["revision"] = json!(revision.to_string());
        page["headRevision"] = page["revision"].clone();
        page["changes"][0]["revision"] = page["revision"].clone();
        page["changes"][0]["organization"]["revision"] = page["revision"].clone();
        page["changes"][0]["prompts"] = json!([]);
        page["changes"][0]["organization"]["tags"] = match revision {
            4 => json!([entry(&target, "Writing"), entry(&last, "Final")]),
            5 => json!([entry(&last, "Final")]),
            _ => json!([]),
        };
        page["changes"][0]["effect"] = json!({"kind":if target_id.is_some(){"tag.merge"}else{"tag.delete"},"sourceId":source_id,"sourceName":source_name,"targetId":target_id,"targetName":target_name,"activeCount":0,"archivedCount":0,"targetActiveCount":0,"targetArchivedCount":0});
        transport.0.lock().unwrap().push(page);
        assert!(service.library_changes(0).unwrap().error.is_none());
        assert_eq!(
            service.library_detail(prompt).unwrap().tag_ids,
            target_id.into_iter().cloned().collect::<Vec<_>>()
        );
        assert!(service
            .library_organization_browse(
                serde_json::from_value(
                    json!({"offset":0,"recents":false,"collectionId":null,"tagIds":[source]})
                )
                .unwrap()
            )
            .unwrap()
            .is_empty());
    }
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
fn organization_request(
    service: &AuthService,
    action: serde_json::Value,
) -> super::organization_contract::OrganizeRequest {
    serde_json::from_value(json!({"instanceId": fixtures()["session"]["instance"]["id"], "accountId": fixtures()["session"]["account"]["id"], "generation":view(service)["generation"],"operationId":uuid::Uuid::new_v4().to_string(),"expectedLocalRevision":service.library_organization().unwrap()["localRevision"],"action":action})).unwrap()
}
#[test]
fn offline_organization_rejection_keeps_name_and_unrelated_uploads_continue() {
    let directory = std::env::temp_dir().join(format!("pr0-org-upload-{}", uuid::Uuid::new_v4()));
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
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
    let id = uuid::Uuid::new_v4().to_string();
    let create = organization_request(
        &service,
        json!({"kind":"collection.create","id":id,"name":"Work"}),
    );
    let rejected = create.operation_id.clone();
    service.library_organize(create).unwrap();
    transport.0.lock().unwrap().extend([fixtures()["capabilities"].clone(),fixtures()["session"].clone(),json!({"results":[{"status":"rejected","error":{"operationId":rejected,"code":"name_conflict","message":"Correct the name","retryable":false}}]})]);
    assert_eq!(service.library_upload().unwrap().waiting, 1);
    assert_eq!(
        service.library_organization().unwrap()["pending"][0]["error"],
        "name_conflict"
    );
    let other = organization_request(
        &service,
        json!({"kind":"tag.create","id":uuid::Uuid::new_v4().to_string(),"name":"Independent"}),
    );
    let op = other.operation_id.clone();
    let tag = other.action.parts().1.to_string();
    service.library_organize(other).unwrap();
    transport.0.lock().unwrap().extend([fixtures()["capabilities"].clone(),fixtures()["session"].clone(),json!({"results":[{"status":"accepted","operationId":op,"tagId":tag,"resolvedTagId":tag,"outcome":"created","revision":"3","acceptedAt":"2026-09-20T00:00:00.000Z"}]})]);
    let status = service.library_upload().unwrap();
    assert_eq!(status.waiting, 1);
    assert_eq!(status.awaiting_download, 1);
    let mut correction = organization_request(
        &service,
        json!({"kind":"collection.create","id":id,"name":"Personal Work"}),
    );
    correction.replaces = Some(rejected);
    service.library_organize(correction).unwrap();
    assert!(service.library_organization().unwrap()["collections"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["name"] == "Personal Work"));
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_merge_requires_approval_and_keeps_prompts_and_review_membership() {
    let directory = std::env::temp_dir().join(format!("pr0-organization-{}", uuid::Uuid::new_v4()));
    let service =
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    let prompt = service
        .library_create(save_request(&service))
        .unwrap()
        .prompt;
    let source = uuid::Uuid::new_v4().to_string();
    let target = uuid::Uuid::new_v4().to_string();
    for (id, name) in [(&source, "Draft"), (&target, "Writing")] {
        service
            .library_organize(organization_request(
                &service,
                json!({"kind":"tag.create","id":id,"name":name}),
            ))
            .unwrap();
    }
    service
        .library_organize(organization_request(
            &service,
            json!({"kind":"prompt.tags","id":prompt.id,"add":[source,target],"remove":[]}),
        ))
        .unwrap();
    let before = service.library_detail(&prompt.id).unwrap();
    assert_eq!(
        service
            .library_organize(organization_request(
                &service,
                json!({"kind":"tag.rename","id":source,"name":"writing"})
            ))
            .err()
            .as_deref(),
        Some("name_conflict")
    );
    assert_eq!(service.library_detail(&prompt.id).unwrap().tag_ids.len(), 2);
    let merge = organization_request(
        &service,
        json!({"kind":"tag.merge","id":source,"targetId":target}),
    );
    let operation_id = merge.operation_id.clone();
    let result = service.library_organize(merge).unwrap();
    assert_eq!(result["effect"]["activeCount"], 1);
    assert_eq!(result["effect"]["targetActiveCount"], 1);
    let after = service.library_detail(&prompt.id).unwrap();
    assert_eq!(after.tag_ids, vec![target.clone()]);
    assert_eq!(after.content, before.content);
    service
        .library_organize(organization_request(
            &service,
            json!({"kind":"tag.delete","id":target}),
        ))
        .unwrap();
    assert!(service
        .library_detail(&prompt.id)
        .unwrap()
        .tag_ids
        .is_empty());
    let review = service
        .library_organization_review(&operation_id, 0)
        .unwrap();
    assert_eq!(review["prompts"][0]["current"]["id"], prompt.id);
    let states = service.library_organization().unwrap();
    let source_state = states["states"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == source)
        .unwrap();
    assert!(source_state["targetId"].is_null());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_organization_names_survive_restart_and_keep_unicode_identity() {
    let directory = std::env::temp_dir().join(format!("pr0-organization-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    sign_in(&service);
    let id = uuid::Uuid::new_v4().to_string();
    let request = json!({
        "instanceId": fixtures()["session"]["instance"]["id"],
        "accountId": fixtures()["session"]["account"]["id"],
        "generation": view(&service)["generation"],
        "operationId": uuid::Uuid::new_v4().to_string(),
        "action": {"kind":"tag.create", "id":id, "name":"  Straße  "}
    });
    let saved = service
        .library_organize(serde_json::from_value(request.clone()).unwrap())
        .unwrap();
    assert_eq!(saved["id"], id);
    assert_eq!(
        service.library_organization().unwrap()["tags"][0]["name"],
        "Straße"
    );
    let mut equivalent = request;
    equivalent["operationId"] = json!(uuid::Uuid::new_v4().to_string());
    equivalent["action"]["id"] = json!(uuid::Uuid::new_v4().to_string());
    equivalent["action"]["name"] = json!("STRASSE");
    assert_eq!(
        service
            .library_organize(serde_json::from_value(equivalent).unwrap())
            .unwrap()["id"],
        id
    );
    assert_eq!(service.sign_out().err().as_deref(), Some("pending_work"));
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
    let snapshot = reopened.library_organization().unwrap();
    assert_eq!(snapshot["tags"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["pending"].as_array().unwrap().len(), 1);
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

fn organization_capacity_data() -> serde_json::Value {
    use sha2::{Digest, Sha256};
    let mut data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let mut records: serde_json::Value =
        serde_json::from_str(data["pages"][0]["payload"].as_str().unwrap()).unwrap();
    let entries = |count: usize, kind: &str| {
        (0..count).map(|index|json!({"id":uuid::Uuid::new_v4().to_string(),"name":format!("{kind} {index:04}"),"revision":"2","activeCount":0,"archivedCount":0,"totalCount":0})).collect::<Vec<_>>()
    };
    records["organization"]["collections"] = json!(entries(200, "Collection"));
    records["organization"]["tags"] = json!(entries(1000, "Tag"));
    records["organization"]["textBytes"] = json!(20000);
    let payload = records.to_string();
    data["manifest"]["pages"][0]["digest"] =
        json!(format!("{:x}", Sha256::digest(payload.as_bytes())));
    data["manifest"]["pages"][0]["bytes"] = json!(payload.len());
    data["pages"][0]["payload"] = json!(payload);
    data
}
fn organization_capacity_transport() -> Arc<Fixture> {
    let data = organization_capacity_data();
    let transport = approval();
    transport.0.lock().unwrap().pop();
    transport.0.lock().unwrap().extend([
        data["manifest"].clone(),
        data["pages"][0].clone(),
        data["pages"][1].clone(),
    ]);
    transport
}

#[test]
fn offline_organization_readd_after_acknowledgement_retains_causality() {
    let (directory, service, transport) = downloaded_change_fixture();
    let tag = uuid::Uuid::new_v4().to_string();
    let mut page = change_fixture();
    page["changes"][0]["organization"]["tags"] = json!([{"id":tag,"name":"Writing","revision":"3","activeCount":0,"archivedCount":0,"totalCount":0}]);
    page["changes"][0]["prompts"] = json!([]);
    transport.0.lock().unwrap().push(page);
    service.library_changes(0).unwrap();
    let prompt = "66666666-6666-4666-8666-666666666666";
    let remove = organization_request(
        &service,
        json!({"kind":"prompt.tags","id":prompt,"add":[],"remove":[tag]}),
    );
    let remove_id = remove.operation_id.clone();
    service.library_organize(remove).unwrap();
    transport.0.lock().unwrap().extend([fixtures()["capabilities"].clone(),fixtures()["session"].clone(),json!({"results":[{"status":"accepted","operationId":remove_id,"promptId":prompt,"revision":"4","acceptedAt":"2026-09-20T00:00:00.000Z"}]})]);
    assert!(service.library_upload().unwrap().error.is_none());
    let add = organization_request(
        &service,
        json!({"kind":"prompt.tags","id":prompt,"add":[tag],"remove":[]}),
    );
    let add_id = add.operation_id.clone();
    service.library_organize(add).unwrap();
    for (operation, revision) in [(&add_id, "5")] {
        transport.0.lock().unwrap().extend([fixtures()["capabilities"].clone(),fixtures()["session"].clone(),json!({"results":[{"status":"accepted","operationId":operation,"promptId":prompt,"revision":revision,"acceptedAt":"2026-09-20T00:00:00.000Z"}]})]);
        assert!(service.library_upload().unwrap().error.is_none());
    }
    let snapshot = service.library_organization().unwrap();
    let readd = snapshot["pending"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == add_id)
        .unwrap();
    assert_eq!(readd["operation"]["baseRevision"], "4");
    assert_eq!(service.library_detail(prompt).unwrap().tag_ids, vec![tag]);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
