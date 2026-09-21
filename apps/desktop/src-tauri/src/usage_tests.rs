#[test]
fn clipboard_success_records_local_recents_and_survives_restart() {
    let directory = std::env::temp_dir().join(format!("pr0-use-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service =
        downloaded_upload_service(&directory, upload_fixture(false, false), vault.clone());
    let id = "66666666-6666-4666-8666-666666666666";
    let before = service.library_detail(id).unwrap();
    let request = super::usage_contract::CopyRequest {
        instance_id: before.instance_id.clone(),
        account_id: before.account_id.clone(),
        generation: view(&service)["generation"].as_u64().unwrap(),
        prompt_id: id.into(),
        template: None,
        values: Vec::new(),
    };
    assert!(service
        .library_copy(request.clone(), |_| Err("clipboard_unavailable".into()))
        .is_err());
    assert_eq!(
        service.library_detail(id).unwrap().use_count,
        before.use_count
    );
    let copied = service
        .library_copy(request, |text| {
            assert_eq!(text, before.content);
            Ok(())
        })
        .unwrap();
    assert!(copied.usage_saved);
    assert_eq!(
        service.library_detail(id).unwrap().modified_at,
        before.modified_at
    );
    assert_eq!(service.library_recents(0).unwrap()[0].id, id);
    drop(service);
    let service = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(service.library_recents(0).unwrap()[0].id, id);
    assert_eq!(service.library_usage_status().unwrap().waiting, 1);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
fn copy_request(service: &AuthService, id: &str) -> super::usage_contract::CopyRequest {
    let state = view(service);
    super::usage_contract::CopyRequest {
        instance_id: state["instanceId"].as_str().unwrap().into(),
        account_id: state["accountId"].as_str().unwrap().into(),
        generation: state["generation"].as_u64().unwrap(),
        prompt_id: id.into(),
        template: None,
        values: Vec::new(),
    }
}
#[test]
fn clipboard_storage_failure_retries_usage_only_and_blocks_sign_out() {
    let directory = std::env::temp_dir().join(format!("pr0-use-io-{}", uuid::Uuid::new_v4()));
    let service = downloaded_upload_service(
        &directory,
        upload_fixture(false, false),
        Arc::new(Vault::default()),
    );
    let request = copy_request(&service, "66666666-6666-4666-8666-666666666666");
    super::library_storage::set_test_fault("usage_io_error");
    let copied = service.library_copy(request, |_| Ok(())).unwrap();
    super::library_storage::set_test_fault("");
    assert!(!copied.usage_saved);
    assert_eq!(service.library_usage_status().unwrap().memory_only, 1);
    assert_eq!(service.sign_out().err().as_deref(), Some("pending_work"));
    service.library_retry_usage().unwrap();
    assert_eq!(service.library_usage_status().unwrap().memory_only, 0);
    assert_eq!(service.library_usage_status().unwrap().waiting, 1);
    service.library_retry_usage().unwrap();
    assert_eq!(service.library_usage_status().unwrap().waiting, 1);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn clipboard_rejects_overlapping_windows_and_obsolete_partition() {
    let directory = std::env::temp_dir().join(format!("pr0-use-race-{}", uuid::Uuid::new_v4()));
    let service = Arc::new(downloaded_upload_service(
        &directory,
        upload_fixture(false, false),
        Arc::new(Vault::default()),
    ));
    let request = copy_request(&service, "66666666-6666-4666-8666-666666666666");
    let mut stale = request.clone();
    stale.generation += 1;
    assert_eq!(
        service
            .library_copy(stale, |_| panic!("stale write"))
            .err()
            .as_deref(),
        Some("operation_cancelled")
    );
    let entered = Arc::new(std::sync::Barrier::new(2));
    let release = Arc::new(std::sync::Barrier::new(2));
    let other = service.clone();
    let input = request.clone();
    let started = entered.clone();
    let finish = release.clone();
    let thread = std::thread::spawn(move || {
        other.library_copy(input, |_| {
            started.wait();
            finish.wait();
            Ok(())
        })
    });
    entered.wait();
    assert_eq!(
        service
            .launcher_copy(request.clone(), |_| panic!("queued launcher write"))
            .err()
            .as_deref(),
        Some("clipboard_busy")
    );
    assert_eq!(
        service
            .copy_draft(
                &request.instance_id,
                &request.account_id,
                request.generation,
                "draft",
                |_| panic!("queued draft")
            )
            .err()
            .as_deref(),
        Some("clipboard_busy")
    );
    release.wait();
    thread.join().unwrap().unwrap();
    assert_eq!(service.library_usage_status().unwrap().waiting, 1);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn usage_delivery_replays_uuid_and_corrects_future_recency() {
    struct UsageTransport {
        inner: Arc<UploadFixture>,
        bodies: Mutex<Vec<serde_json::Value>>,
    }
    impl Transport for UsageTransport {
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
            if matches!(endpoint, Endpoint::Mutations | Endpoint::Receipts) {
                let body = body.unwrap();
                let mut sent = self.bodies.lock().unwrap();
                sent.push(body.clone());
                if sent.len() == 1 {
                    return Err("network_unavailable".into());
                }
                let op = &body["operations"][0];
                return Ok(
                    json!({"results":[{"status":"accepted","operationId":op["operationId"],"promptId":op["promptId"],"revision":"3","acceptedAt":"2026-09-20T12:00:00.000Z","usedAt":"2026-09-20T12:00:00.000Z"}]}),
                );
            }
            self.inner.request(origin, endpoint, token, body)
        }
    }
    let directory = std::env::temp_dir().join(format!("pr0-use-sync-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let transport = Arc::new(UsageTransport {
        inner: upload_fixture(false, false),
        bodies: Mutex::new(vec![]),
    });
    let service = AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    service.library_download().unwrap();
    let id = "66666666-6666-4666-8666-666666666666";
    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/prompt-use-fixtures.json"
    ))
    .unwrap();
    super::usage_contract::TEST_TIME
        .with(|time| *time.borrow_mut() = Some(fixtures["future"].as_str().unwrap().into()));
    service
        .library_copy(copy_request(&service, id), |_| Ok(()))
        .unwrap();
    super::usage_contract::TEST_TIME.with(|time| *time.borrow_mut() = None);
    let failed = service.library_sync_usage().unwrap();
    assert_eq!(failed.waiting, 1);
    assert!(failed.error.is_some());
    drop(service);
    let service = AuthService::new(directory.clone(), transport.clone(), vault).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(failed.retry_after_ms + 20));
    let synced = service.library_sync_usage().unwrap();
    assert_eq!(synced.waiting, 0);
    assert_eq!(synced.awaiting_download, 1);
    assert_eq!(
        service.library_detail(id).unwrap().last_used_at.as_deref(),
        Some("2026-09-20T12:00:00.000Z")
    );
    let sent = transport.bodies.lock().unwrap();
    assert_eq!(sent[0], sent[1]);
    drop(sent);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn clipboard_native_os_write_preserves_exact_text() {
    let directory = std::env::temp_dir().join(format!("pr0-use-os-{}", uuid::Uuid::new_v4()));
    let service = downloaded_upload_service(
        &directory,
        upload_fixture(false, false),
        Arc::new(Vault::default()),
    );
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/prompt-use-fixtures.json"
    ))
    .unwrap();
    let mut request = save_request(&service);
    request.desired.content = fixture["text"].as_str().unwrap().into();
    service.library_create(request.clone()).unwrap();
    service
        .library_copy(
            copy_request(&service, &request.prompt_id),
            super::clipboard::write,
        )
        .unwrap();
    assert_eq!(
        arboard::Clipboard::new().unwrap().get_text().unwrap(),
        request.desired.content
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
fn usage_test_command(
    service: &AuthService,
    input: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    match input["command"].as_str().unwrap() {
        "library_copy" => {
            super::library_storage::set_test_fault(input["fault"].as_str().unwrap_or(""));
            super::usage_contract::TEST_TIME
                .with(|time| *time.borrow_mut() = input["occurredAt"].as_str().map(String::from));
            let result = service
                .library_copy(
                    serde_json::from_value(input["request"].clone()).unwrap(),
                    |text| {
                        if input["fault"] == "clipboard_fixture" {
                            // Lifecycle journeys control the external clipboard boundary;
                            // OS clipboard behavior has its separate installed tests.
                            return Ok(());
                        }
                        if input["fault"] == "clipboard_unavailable" {
                            return Err("clipboard_unavailable".into());
                        }
                        super::clipboard::write(text)
                    },
                )
                .map(|v| json!(v));
            super::library_storage::set_test_fault("");
            super::usage_contract::TEST_TIME.with(|time| *time.borrow_mut() = None);
            result
        }
        "library_recents" => service
            .library_recents(input["offset"].as_u64().unwrap_or(0) as u32)
            .map(|v| json!(v)),
        "library_usage_status" => service.library_usage_status().map(|v| json!(v)),
        "library_retry_usage" => service.library_retry_usage().map(|v| json!(v)),
        "library_sync_usage" => service.library_sync_usage().map(|v| json!(v)),
        "test_clipboard_text" => arboard::Clipboard::new()
            .and_then(|mut c| c.get_text())
            .map(|v| json!(v))
            .map_err(|_| "clipboard_unavailable".into()),
        _ => Err("unknown_command".into()),
    }
}
#[test]
fn recents_include_server_usage_without_pending_events_and_exclude_archive() {
    use sha2::{Digest, Sha256};
    let mut fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    for index in 0..2 {
        let mut page: serde_json::Value =
            serde_json::from_str(fixture["pages"][index]["payload"].as_str().unwrap()).unwrap();
        page["prompts"][0]["useCount"] = json!(2);
        page["prompts"][0]["lastUsedAt"] = json!("2002-01-01T00:00:00.000Z");
        page["prompts"][0]["archived"] = json!(index == 1);
        let payload = page.to_string();
        fixture["pages"][index]["payload"] = json!(payload);
        fixture["manifest"]["pages"][index]["bytes"] = json!(payload.len());
        fixture["manifest"]["pages"][index]["digest"] =
            json!(format!("{:x}", Sha256::digest(payload.as_bytes())));
    }
    let directory = std::env::temp_dir().join(format!("pr0-server-use-{}", uuid::Uuid::new_v4()));
    let transport = approval();
    transport.0.lock().unwrap().pop();
    transport.0.lock().unwrap().extend([
        fixture["manifest"].clone(),
        fixture["pages"][0].clone(),
        fixture["pages"][1].clone(),
    ]);
    let service =
        AuthService::new(directory.clone(), transport, Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    service.library_download().unwrap();
    let rows = service.library_recents(0).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].title, "First");
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn recents_paginate_the_complete_view_without_duplicate_rows() {
    let directory =
        std::env::temp_dir().join(format!("pr0-recents-pages-{}", uuid::Uuid::new_v4()));
    let service = downloaded_upload_service(
        &directory,
        upload_fixture(false, false),
        Arc::new(Vault::default()),
    );
    for index in 0..53 {
        let mut request = save_request(&service);
        request.prompt_id = uuid::Uuid::new_v4().to_string();
        request.operation_id = uuid::Uuid::new_v4().to_string();
        request.desired.title = format!("Prompt {index:02}");
        service.library_create(request.clone()).unwrap();
        super::usage_contract::TEST_TIME
            .with(|time| *time.borrow_mut() = Some("2002-01-01T00:00:00.000Z".into()));
        service
            .library_copy(copy_request(&service, &request.prompt_id), |_| Ok(()))
            .unwrap();
        service
            .library_copy(copy_request(&service, &request.prompt_id), |_| Ok(()))
            .unwrap();
        super::usage_contract::TEST_TIME.with(|time| *time.borrow_mut() = None);
    }
    let first = service.library_recents(0).unwrap();
    let last = service.library_recents(50).unwrap();
    assert_eq!(first.len(), 50);
    assert_eq!(last.len(), 3);
    assert_eq!(last[2].title, "Prompt 52");
    assert_eq!(first[0].title, "Prompt 00");
    assert!(service.library_recents(100).unwrap().is_empty());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
