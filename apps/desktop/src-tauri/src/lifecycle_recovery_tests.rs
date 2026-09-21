#[test]
fn lifecycle_replacement_preserves_pending_favorite_and_archive() {
    let (directory, service, transport) = downloaded_change_fixture();
    let id = "66666666-6666-4666-8666-666666666666";
    service.library_lifecycle(lifecycle_request(&service,id,json!({"kind":"favorite","value":true}))).unwrap();
    service.library_lifecycle(lifecycle_request(&service,id,json!({"kind":"archive","value":true}))).unwrap();
    transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_required"}));
    service.library_changes(0).unwrap();
    let data = replacement_fixture();
    transport.0.lock().unwrap().extend([data["manifest"].clone(),data["pages"][0].clone(),data["pages"][1].clone(),change_fixture()]);
    for _ in 0..3 { service.library_download().unwrap(); }
    let prompt = service.library_detail(id).unwrap();
    assert!(prompt.favorite);
    assert!(prompt.archived);
    assert_eq!(service.library_upload_status().unwrap().waiting, 2);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_metadata_only_replacement_keeps_current_server_text() {
    use sha2::{Digest, Sha256};
    let (directory, service, transport) = downloaded_change_fixture();
    let id = "66666666-6666-4666-8666-666666666666";
    service.library_lifecycle(lifecycle_request(&service,id,json!({"kind":"favorite","value":true}))).unwrap();
    transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_required"}));
    service.library_changes(0).unwrap();
    let mut data = replacement_fixture();
    let mut payload: serde_json::Value = serde_json::from_str(data["pages"][0]["payload"].as_str().unwrap()).unwrap();
    payload["prompts"][0]["content"] = json!("Newer server text");
    payload["prompts"][0]["revision"] = json!("2");
    let payload = payload.to_string();
    data["manifest"]["pages"][0] = json!({"bytes":payload.len(),"digest":format!("{:x}",Sha256::digest(payload.as_bytes()))});
    data["pages"][0]["payload"] = json!(payload);
    let mut changes = change_fixture();
    changes["changes"] = json!([]);
    changes["revision"] = json!("2");
    changes["headRevision"] = json!("2");
    transport.0.lock().unwrap().extend([data["manifest"].clone(),data["pages"][0].clone(),data["pages"][1].clone(),changes]);
    for _ in 0..3 { service.library_download().unwrap(); }
    let prompt = service.library_detail(id).unwrap();
    assert_eq!(prompt.content,"Newer server text");
    assert!(prompt.favorite);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_retry_cannot_release_pre_restore_work() {
    let (directory, service, transport) = downloaded_change_fixture();
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_required"}));
    service.library_changes(0).unwrap();
    let mut data = replacement_fixture();
    data["manifest"]["epoch"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    let mut changes = change_fixture();
    changes["epoch"] = data["manifest"]["epoch"].clone();
    transport.0.lock().unwrap().extend([data["manifest"].clone(),data["pages"][0].clone(),data["pages"][1].clone(),changes]);
    for _ in 0..3 { service.library_download().unwrap(); }
    let recovery = super::lifecycle_contract::RecoveryRequest {
        instance_id: request.instance_id, account_id: request.account_id, generation: request.generation,
        prompt_id: request.prompt_id.clone(), action: super::lifecycle_contract::RecoveryAction::Retry, confirmed: false,
    };
    assert_eq!(service.library_recover(recovery).err().as_deref(),Some("recovery_required"));
    assert_eq!(service.library_upload().unwrap().waiting, 1);
    assert_eq!(service.library_retained_prompt(&request.prompt_id).unwrap().content,request.desired.content);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn lifecycle_actions_during_epoch_replacement_require_recovery() {
    for action in [
        json!({"kind":"favorite","value":true}),
        json!({"kind":"archive","value":true}),
        json!({"kind":"delete","confirmed":true}),
        json!({"kind":"duplicate","copyId":uuid::Uuid::new_v4().to_string()}),
    ] {
        let (directory, service, transport) = downloaded_change_fixture();
        let id = "66666666-6666-4666-8666-666666666666";
        transport.0.lock().unwrap().push(json!({"fixtureFailure":"snapshot_required"}));
        service.library_changes(0).unwrap();
        let mut data = replacement_fixture();
        data["manifest"]["epoch"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        let mut changes = change_fixture();
        changes["epoch"] = data["manifest"]["epoch"].clone();
        transport.0.lock().unwrap().extend([data["manifest"].clone(),data["pages"][0].clone(),data["pages"][1].clone(),changes]);
        service.library_download().unwrap();
        let saved = service.library_lifecycle(lifecycle_request(&service,id,action)).unwrap();
        service.library_download().unwrap();
        service.library_download().unwrap();
        let status = service.library_upload_status().unwrap();
        assert!(status.errors.iter().any(|entry|entry.prompt_id==saved.prompt_id && entry.code=="recovery_required"));
        assert_eq!(service.library_upload().unwrap().waiting, 1);
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
