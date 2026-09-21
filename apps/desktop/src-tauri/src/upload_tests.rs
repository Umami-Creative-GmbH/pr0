// Typed AuthService commands, real SQLite, controlled HTTPS boundary failures.
struct UploadFixture {
    traffic: Mutex<Vec<(bool, serde_json::Value)>>,
    lose: std::sync::atomic::AtomicBool,
    conflict: bool,
    quota: bool,
    failure: Mutex<Option<String>>,
    entered: Option<Arc<std::sync::Barrier>>,
    release: Option<Arc<std::sync::Barrier>>,
}
impl Transport for UploadFixture {
    fn open_browser(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    fn request(
        &self,
        _: &str,
        endpoint: Endpoint,
        _: Option<&str>,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let data = fixtures();
        match endpoint {
            Endpoint::Capabilities => Ok(data["capabilities"].clone()),
            Endpoint::Code => Ok(data["code"].clone()),
            Endpoint::Token => Ok(data["token"].clone()),
            Endpoint::Session => Ok(data["session"].clone()),
            Endpoint::Changes => {
                let mut change = change_fixture();
                change["changes"][0]["prompts"] = json!([]);
                change["changes"][0]["deletedPromptIds"] = json!(["66666666-6666-4666-8666-666666666666"]);
                Ok(change)
            }
            Endpoint::Snapshot | Endpoint::SnapshotPage => {
                let snapshot: serde_json::Value = serde_json::from_str(include_str!(
                    "../../../../packages/api-contract/src/snapshot-fixtures.json"
                ))
                .unwrap();
                Ok(if matches!(endpoint, Endpoint::Snapshot) {
                    snapshot["manifest"].clone()
                } else {
                    snapshot["pages"][body.unwrap()["page"].as_u64().unwrap() as usize].clone()
                })
            }
            Endpoint::Mutations | Endpoint::Receipts => {
                let body = body.unwrap();
                self.traffic
                    .lock()
                    .unwrap()
                    .push((matches!(endpoint, Endpoint::Receipts), body.clone()));
                if let Some(error) = self.failure.lock().unwrap().take() {
                    return Err(error);
                }
                if self.traffic.lock().unwrap().len() == 1 {
                    if let Some(barrier) = &self.entered {
                        barrier.wait();
                    }
                    if let Some(barrier) = &self.release {
                        barrier.wait();
                    }
                }
                if self.lose.swap(false, std::sync::atomic::Ordering::SeqCst) {
                    return Err("network_unavailable".into());
                }
                let operation = &body["operations"][0];
                if self.quota && operation["desired"]["content"] == "Refused" {
                    return Ok(
                        json!({"results":[{"status":"rejected","error":{"operationId":operation["operationId"],"code":"quota_exceeded","message":"Free capacity","retryable":true}}]}),
                    );
                }
                let mut receipt = json!({"status":"accepted","operationId":operation["operationId"],"promptId":operation["promptId"],"revision":"3","acceptedAt":"2026-09-20T12:00:00.000Z"});
                if operation["kind"] == "prompt.use" {
                    receipt["usedAt"] = json!(operation["occurredAt"]
                        .as_str()
                        .unwrap()
                        .min("2026-09-20T12:00:00.000Z"));
                }
                if self.conflict && operation["promptId"] != "99999999-9999-4999-8999-999999999999"
                {
                    receipt["conflict"] = json!({"copyId":"99999999-9999-4999-8999-999999999999","noticeId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"});
                }
                Ok(json!({"results":[receipt]}))
            }
            _ => Ok(json!({"success":true})),
        }
    }
}
fn upload_fixture(conflict: bool, quota: bool) -> Arc<UploadFixture> {
    Arc::new(UploadFixture {
        traffic: Mutex::new(vec![]),
        lose: std::sync::atomic::AtomicBool::new(false),
        conflict,
        quota,
        failure: Mutex::new(None),
        entered: None,
        release: None,
    })
}
fn downloaded_upload_service(
    directory: &std::path::Path,
    transport: Arc<UploadFixture>,
    vault: Arc<Vault>,
) -> AuthService {
    let service = AuthService::new(directory.into(), transport, vault).unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    service.library_download().unwrap();
    service
}
#[test]
fn upload_lost_create_reopens_and_replays_exact_frozen_envelope_with_successor() {
    let directory =
        std::env::temp_dir().join(format!("pr0-upload-restart-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(false, false);
    transport
        .lose
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let vault = Arc::new(Vault::default());
    let service = downloaded_upload_service(&directory, transport.clone(), vault.clone());
    let mut request = save_request(&service);
    let first = service.library_create(request.clone()).unwrap();
    assert_eq!(
        service.library_upload().unwrap().error.as_deref(),
        Some("network_unavailable")
    );
    request.operation_id = uuid::Uuid::new_v4().to_string();
    request.expected_local_revision = Some(first.local_revision);
    request.desired.content = "Later local text".into();
    service.library_edit(request.clone()).unwrap();
    drop(service);
    let service = AuthService::new(directory.clone(), transport.clone(), vault).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(
        service.library_upload_status().unwrap().retry_after_ms + 25,
    ));
    let status = service.library_upload().unwrap();
    assert!(status.error.is_none());
    assert_eq!(status.waiting, 1);
    let traffic = transport.traffic.lock().unwrap();
    assert!(traffic[1].0);
    assert_eq!(traffic[0].1, traffic[1].1);
    drop(traffic);
    assert_eq!(
        service.library_detail(&request.prompt_id).unwrap().content,
        "Later local text"
    );
    let pending = service.library_pending().unwrap();
    assert_eq!(pending[1].payload["baseRevision"], "3");
    assert_eq!(pending[1].payload["kind"], "prompt.update");
    assert_eq!(pending[1].payload["desired"]["content"], "Later local text");
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn upload_conflict_acknowledgement_retargets_edit_saved_while_network_waits() {
    let directory =
        std::env::temp_dir().join(format!("pr0-upload-conflict-{}", uuid::Uuid::new_v4()));
    let entered = Arc::new(std::sync::Barrier::new(2));
    let release = Arc::new(std::sync::Barrier::new(2));
    let transport = Arc::new(UploadFixture {
        traffic: Mutex::new(vec![]),
        lose: std::sync::atomic::AtomicBool::new(false),
        conflict: true,
        quota: false,
        failure: Mutex::new(None),
        entered: Some(entered.clone()),
        release: Some(release.clone()),
    });
    let service = Arc::new(downloaded_upload_service(
        &directory,
        transport.clone(),
        Arc::new(Vault::default()),
    ));
    let mut request = save_request(&service);
    request.prompt_id = "66666666-6666-4666-8666-666666666666".into();
    request.expected_local_revision = Some(
        service
            .library_editor(&request.prompt_id)
            .unwrap()
            .local_revision,
    );
    request.desired.content = "B1".into();
    let first = service.library_edit(request.clone()).unwrap();
    let worker = service.clone();
    let upload = std::thread::spawn(move || worker.library_upload());
    entered.wait();
    request.operation_id = uuid::Uuid::new_v4().to_string();
    request.expected_local_revision = Some(first.local_revision);
    request.desired.content = "B2".into();
    service.library_edit(request).unwrap();
    release.wait();
    let status = upload.join().unwrap().unwrap();
    assert!(status.error.is_none());
    assert_eq!(
        status.mappings[0].copy_id,
        "99999999-9999-4999-8999-999999999999"
    );
    assert_eq!(
        service
            .library_detail(&status.mappings[0].copy_id)
            .unwrap()
            .content,
        "B2"
    );
    assert_eq!(
        service
            .library_detail(&status.mappings[0].original_id)
            .unwrap()
            .content,
        "  Hello offline\n"
    );
    let pending = service.library_pending().unwrap();
    assert_eq!(
        pending[1].payload["promptId"],
        "99999999-9999-4999-8999-999999999999"
    );
    assert_eq!(pending[1].payload["base"]["content"], "B1");
    assert_eq!(pending[1].payload["desired"]["content"], "B2");
    service.library_upload().unwrap();
    assert_eq!(
        transport.traffic.lock().unwrap()[1].1["operations"][0]["promptId"],
        "99999999-9999-4999-8999-999999999999"
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn upload_quota_refusal_blocks_successor_and_allows_unrelated_create() {
    let directory = std::env::temp_dir().join(format!("pr0-upload-quota-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(false, true);
    let service =
        downloaded_upload_service(&directory, transport.clone(), Arc::new(Vault::default()));
    let mut request = save_request(&service);
    request.desired.content = "Refused".into();
    let first = service.library_create(request.clone()).unwrap();
    let status = service.library_upload().unwrap();
    assert_eq!(status.errors[0].code, "quota_exceeded");
    request.operation_id = uuid::Uuid::new_v4().to_string();
    request.expected_local_revision = Some(first.local_revision);
    request.desired.content = "Saved successor".into();
    service.library_edit(request.clone()).unwrap();
    let mut unrelated = save_request(&service);
    unrelated.prompt_id = uuid::Uuid::new_v4().to_string();
    unrelated.operation_id = uuid::Uuid::new_v4().to_string();
    service.library_create(unrelated.clone()).unwrap();
    let status = service.library_upload().unwrap();
    assert_eq!(status.waiting, 2);
    assert_eq!(status.awaiting_download, 1);
    assert_eq!(
        transport.traffic.lock().unwrap()[1].1["operations"][0]["promptId"],
        unrelated.prompt_id
    );
    assert_eq!(
        service.library_detail(&request.prompt_id).unwrap().content,
        "Saved successor"
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn upload_authentication_failure_and_retry_after_preserve_work_without_hammering_server() {
    for error in ["authentication_required", "retry_after:120"] {
        let directory =
            std::env::temp_dir().join(format!("pr0-upload-delay-{}", uuid::Uuid::new_v4()));
        let transport = upload_fixture(false, false);
        let service =
            downloaded_upload_service(&directory, transport.clone(), Arc::new(Vault::default()));
        let request = save_request(&service);
        service.library_create(request.clone()).unwrap();
        *transport.failure.lock().unwrap() = Some(error.into());
        let status = service.library_upload().unwrap();
        assert_eq!(status.error.as_deref(), Some(error));
        assert_eq!(status.waiting, 1);
        assert_eq!(status.awaiting_download, 0);
        assert!(status.retry_after_ms > 0);
        if error == "retry_after:120" {
            assert!(status.retry_after_ms >= 119_000 && status.retry_after_ms <= 121_000);
        } else {
            assert_eq!(view(&service)["state"], "authentication_required");
        }
        service.library_upload().unwrap();
        assert_eq!(transport.traffic.lock().unwrap().len(), 1);
        assert_eq!(
            service.library_detail(&request.prompt_id).unwrap().content,
            request.desired.content
        );
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[test]
fn upload_process_kill_rolls_back_acknowledgement_and_replays_frozen_identity() {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};
    for stage in ["upload_frozen", "upload_acknowledgement"] {
        let directory =
            std::env::temp_dir().join(format!("pr0-upload-kill-{}", uuid::Uuid::new_v4()));
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "auth_tests::offline_command_worker",
                "--nocapture",
            ])
            .env("PR0_LOCAL_TEST_DIRECTORY", &directory)
            .env("PR0_UPLOAD_UI_FIXTURE", "true")
            .env("PR0_LOCAL_TEST_PAUSE", stage)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut output = BufReader::new(child.stdout.take().unwrap());
        let mut line = String::new();
        loop {
            line.clear();
            assert!(output.read_line(&mut line).unwrap() > 0);
            if line.starts_with("READY:") {
                break;
            }
        }
        let generation: u64 = line.trim().strip_prefix("READY:").unwrap().parse().unwrap();
        let operation_id = uuid::Uuid::new_v4().to_string();
        let prompt_id = uuid::Uuid::new_v4().to_string();
        let request = json!({"command":"library_create","request":{
            "instanceId":"11111111-1111-4111-8111-111111111111","accountId":"33333333-3333-4333-8333-333333333333","generation":generation,
            "operationId":operation_id,"promptId":prompt_id,"expectedLocalRevision":null,
            "desired":{"title":"Killed upload","description":"","content":"Retain exact text\n"}}});
        writeln!(child.stdin.as_mut().unwrap(), "{request}").unwrap();
        loop {
            line.clear();
            assert!(output.read_line(&mut line).unwrap() > 0);
            if line.starts_with("RESULT:") {
                assert!(line.contains("\"Ok\""), "{line}");
                break;
            }
        }
        writeln!(
            child.stdin.as_mut().unwrap(),
            "{}",
            json!({"command":"library_upload"})
        )
        .unwrap();
        loop {
            line.clear();
            assert!(output.read_line(&mut line).unwrap() > 0);
            if line.trim() == format!("PAUSED:{stage}") {
                break;
            }
            assert!(!line.starts_with("RESULT:"), "{line}");
        }
        child.kill().unwrap();
        child.wait().unwrap();
        let transport = upload_fixture(true, false);
        let service = AuthService::new(
            directory.clone(),
            transport.clone(),
            Arc::new(Vault::default()),
        )
        .unwrap();
        assert_eq!(
            service.library_detail(&prompt_id).unwrap().content,
            "Retain exact text\n"
        );
        let status = service.library_upload_status().unwrap();
        assert_eq!(status.waiting, 1);
        assert_eq!(status.awaiting_download, 0);
        assert!(status.mappings.is_empty());
        sign_in(&service);
        let status = service.library_upload().unwrap();
        assert!(status.error.is_none());
        assert_eq!(status.waiting, 0);
        assert_eq!(status.awaiting_download, 1);
        assert_eq!(transport.traffic.lock().unwrap()[0].0, true);
        assert_eq!(
            transport.traffic.lock().unwrap()[0].1["operations"][0]["operationId"],
            operation_id
        );
        assert_eq!(
            service
                .library_detail(&status.mappings[0].copy_id)
                .unwrap()
                .content,
            "Retain exact text\n"
        );
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
