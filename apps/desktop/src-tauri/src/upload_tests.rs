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
        token: Option<&str>,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let data = fixtures();
        match endpoint {
            Endpoint::Adjustments => Ok(json!({"instanceId":data["session"]["instance"]["id"],"accountId":data["session"]["account"]["id"],"revision":"3","nextCursor":null,"notices":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","promptId":"66666666-6666-4666-8666-666666666666","message":"Collection was deleted on another device; your prompt was kept.","revision":"3","createdAt":"2026-09-20T12:00:00.000Z"}]})),
            Endpoint::Conflicts => {
                let snapshot: serde_json::Value = serde_json::from_str(include_str!("../../../../packages/api-contract/src/snapshot-fixtures.json")).unwrap();
                Ok(json!({"instanceId":snapshot["manifest"]["instanceId"],"accountId":snapshot["manifest"]["accountId"],"revision":"3","nextCursor":null,"notices":[{
                    "id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","originalId":"88888888-8888-4888-8888-888888888888","copyId":"99999999-9999-4999-8999-999999999999",
                    "sourceTitle":"Other device's complete title","createdAt":"2026-09-20T12:00:00.000Z","revision":"3","originalDeleted":true,"originalArchived":false,"copyDeleted":false
                }]}))
            }
            Endpoint::DeletionLookup => Ok(json!({"status":"absent"})),
            Endpoint::Capabilities => {
                let mut capabilities = data["capabilities"].clone();
                if token.is_some() && std::env::var("PR0_COMPATIBILITY_UI_FIXTURE").as_deref() == Ok("true") { capabilities["protocols"] = json!([2]); }
                Ok(capabilities)
            },
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
                if self.quota && operation["kind"] == "collection.create" {
                    return Ok(json!({"results":[{"status":"rejected","error":{"operationId":operation["operationId"],"code":"quota_exceeded","message":"Collection capacity reached","retryable":false,"resource":"collectionCount","usage":{"promptCount":2,"textBytes":1000}}}]}));
                }
                if self.quota && operation["kind"].as_str().is_some_and(|k|k.ends_with(".review")) {
                    return Ok(json!({"results":[{"status":"rejected","error":{"operationId":operation["operationId"],"code":"validation_failed","message":"Review rejected","retryable":false}}]}));
                }
                if self.quota && (operation["desired"]["content"] == "Refused" || operation["kind"] == "prompt.delete") {
                    return Ok(
                        json!({"results":[{"status":"rejected","error":{"operationId":operation["operationId"],"code":"quota_exceeded","message":"Free capacity","retryable":true,"resource":"promptCount","usage":{"promptCount":10000,"textBytes":1000}}}]}),
                    );
                }
                let mut receipt = json!({"status":"accepted","operationId":operation["operationId"],"promptId":operation["promptId"],"revision":"3","acceptedAt":"2026-09-20T12:00:00.000Z"});
                if operation["desired"]["content"] == "Adjusted" { receipt["organizationNotice"] = json!("Collection was deleted on another device; your prompt was kept."); }
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
#[test]
fn rejected_review_remains_discoverable_and_retries_the_frozen_identity() {
    let directory=std::env::temp_dir().join(format!("pr0-review-retry-{}",uuid::Uuid::new_v4()));
    let transport=upload_fixture(false,true);
    let vault=Arc::new(Vault::default());
    let service=downloaded_upload_service(&directory,transport.clone(),vault.clone());
    service.library_refresh_conflicts().unwrap();
    let request=json!({"instanceId":view(&service)["instanceId"],"accountId":view(&service)["accountId"],"generation":view(&service)["generation"],"noticeId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"});
    service.library_review_conflict(serde_json::from_value(request.clone()).unwrap()).unwrap();
    service.library_upload().unwrap();
    let pending=service.library_organization().unwrap()["pending"].clone();
    assert_eq!(pending[0]["error"],"validation_failed");
    assert_eq!(pending[0]["operation"]["kind"],"conflict.review");
    service.library_review_conflict(serde_json::from_value(request).unwrap()).unwrap();
    service.library_upload().unwrap();
    let traffic=transport.traffic.lock().unwrap();
    assert_eq!(traffic.len(),2);
    assert_eq!(traffic[0].1,traffic[1].1);
    assert!(traffic[1].0);
    drop(traffic);
    drop(service);
    let service=AuthService::new(directory.clone(),transport,vault).unwrap();
    assert_eq!(service.library_organization().unwrap()["pending"],pending);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
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
fn accepted_adjustment_notice_survives_without_a_followup_download() {
    let directory = std::env::temp_dir().join(format!("pr0-adjustment-receipt-{}",uuid::Uuid::new_v4()));
    let service = downloaded_upload_service(&directory,upload_fixture(false,false),Arc::new(Vault::default()));
    let mut request=save_request(&service);
    request.desired.content="Adjusted".into();
    service.library_create(request).unwrap();
    service.library_upload().unwrap();
    assert_eq!(service.library_adjustments(0).unwrap()["notices"].as_array().unwrap().len(),1);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn organization_adjustment_attention_is_persistent_and_reviewable() {
    let directory = std::env::temp_dir().join(format!("pr0-adjustment-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(false, false);
    let vault = Arc::new(Vault::default());
    let service = downloaded_upload_service(&directory, transport.clone(), vault.clone());
    service.library_refresh_adjustments().unwrap();
    let notices = service.library_adjustments(0).unwrap();
    assert_eq!(notices["notices"][0]["message"], "Collection was deleted on another device; your prompt was kept.");
    service.library_review_adjustment(serde_json::from_value(json!({"instanceId":view(&service)["instanceId"],"accountId":view(&service)["accountId"],"generation":view(&service)["generation"],"noticeId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"})).unwrap()).unwrap();
    drop(service);
    let service = AuthService::new(directory.clone(), transport, vault).unwrap();
    assert_eq!(service.library_adjustments(0).unwrap()["notices"],json!([]));
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn rejected_work_exposes_limiting_resource_after_restart() {
    let directory = std::env::temp_dir().join(format!("pr0-refused-details-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(false, true);
    let vault = Arc::new(Vault::default());
    let service = downloaded_upload_service(&directory, transport.clone(), vault.clone());
    let mut request = save_request(&service);
    request.desired.content = "Refused".into();
    service.library_create(request).unwrap();
    service.library_upload().unwrap();
    drop(service);
    let service = AuthService::new(directory.clone(), transport, vault).unwrap();
    let state = serde_json::to_value(service.library_upload_status().unwrap()).unwrap();
    assert_eq!(state["errors"][0]["failure"]["resource"], "promptCount");
    assert_eq!(state["errors"][0]["failure"]["usage"]["promptCount"], 10000);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn rejected_collection_retains_capacity_details_after_restart() {
    let directory=std::env::temp_dir().join(format!("pr0-org-quota-{}",uuid::Uuid::new_v4()));
    let transport=upload_fixture(false,true);
    let vault=Arc::new(Vault::default());
    let service=downloaded_upload_service(&directory,transport.clone(),vault.clone());
    service.library_organize(organization_request(&service,json!({"kind":"collection.create","id":uuid::Uuid::new_v4().to_string(),"name":"Retained collection"}))).unwrap();
    service.library_upload().unwrap();
    drop(service);
    let service=AuthService::new(directory.clone(),transport,vault).unwrap();
    let snapshot=service.library_organization().unwrap();
    assert_eq!(snapshot["pending"][0]["failure"]["resource"],"collectionCount");
    assert_eq!(snapshot["pending"][0]["failure"]["usage"]["textBytes"],1000);
    assert_eq!(snapshot["pending"][0]["operation"]["name"],"Retained collection");
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

struct AttentionTransport {
    inner: Arc<UploadFixture>,
    pages: Mutex<std::collections::VecDeque<Result<serde_json::Value,String>>>,
}
impl Transport for AttentionTransport {
    fn open_browser(&self, origin:&str)->Result<(),String> { self.inner.open_browser(origin) }
    fn request(&self,origin:&str,endpoint:Endpoint,token:Option<&str>,body:Option<serde_json::Value>)->Result<serde_json::Value,String> {
        if matches!(endpoint,Endpoint::Conflicts|Endpoint::Adjustments) {
            if let Some(page)=self.pages.lock().unwrap().pop_front(){return page;}
        }
        self.inner.request(origin,endpoint,token,body)
    }
}
#[test]
fn incomplete_notice_refresh_preserves_visible_reviews_and_reports_failure_after_restart() {
    let directory=std::env::temp_dir().join(format!("pr0-notice-pages-{}",uuid::Uuid::new_v4()));
    let vault=Arc::new(Vault::default());
    let transport=Arc::new(AttentionTransport{inner:upload_fixture(false,false),pages:Mutex::new(std::collections::VecDeque::new())});
    let service=AuthService::new(directory.clone(),transport.clone(),vault.clone()).unwrap();
    sign_in(&service);
    service.library_refresh_conflicts().unwrap();
    let before=service.library_conflicts(0).unwrap()["notices"].clone();
    let mut first=transport.inner.request("",Endpoint::Conflicts,None,None).unwrap();
    first["nextCursor"]=json!("page-two");
    transport.pages.lock().unwrap().extend([Ok(first),Err("network_unavailable".into())]);
    assert_eq!(service.library_refresh_conflicts().err().as_deref(),Some("network_unavailable"));
    assert_eq!(service.library_conflicts(0).unwrap()["notices"],before);
    transport.pages.lock().unwrap().push_back(Err("invalid_response".into()));
    assert!(service.library_refresh_adjustments().is_err());
    drop(service);
    let service=AuthService::new(directory.clone(),transport.clone(),vault).unwrap();
    assert!(service.library_upload_status().unwrap().attention_error.is_some());
    assert_eq!(service.library_conflicts(0).unwrap()["notices"],before);
    service.restore().unwrap();
    service.library_refresh_conflicts().unwrap();
    service.library_refresh_adjustments().unwrap();
    assert!(service.library_upload_status().unwrap().attention_error.is_none());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn conflict_attention_downloads_other_device_notices_without_replacing_local_text() {
    let directory = std::env::temp_dir().join(format!("pr0-attention-pull-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(true, false);
    let service = downloaded_upload_service(&directory, transport, Arc::new(Vault::default()));
    service.library_refresh_conflicts().unwrap();
    let notices = service.library_conflicts(0).unwrap();
    assert_eq!(notices["notices"][0]["sourceTitle"], "Other device's complete title");
    assert_eq!(notices["notices"][0]["originalAvailable"], false);
    assert_eq!(notices["notices"][0]["originalDeleted"], true);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn conflict_attention_survives_restart_and_review_keeps_retained_copy() {
    let directory = std::env::temp_dir().join(format!("pr0-attention-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(true, false);
    let vault = Arc::new(Vault::default());
    let service = downloaded_upload_service(&directory, transport.clone(), vault.clone());
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    service.library_upload().unwrap();
    let notices = service.library_conflicts(0).unwrap();
    assert_eq!(notices["notices"][0]["sourceTitle"], request.desired.title);
    drop(service);
    let service = AuthService::new(directory.clone(), transport, vault).unwrap();
    assert_eq!(service.library_conflicts(0).unwrap(), notices);
    let status = service.status().unwrap();
    service.library_review_conflict(serde_json::from_value(json!({
        "instanceId": request.instance_id, "accountId": request.account_id,
        "generation": serde_json::to_value(status).unwrap()["generation"],
        "noticeId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    })).unwrap()).unwrap();
    assert_eq!(service.library_conflicts(0).unwrap()["notices"], json!([]));
    assert_eq!(service.library_detail("99999999-9999-4999-8999-999999999999").unwrap().content, request.desired.content);
    assert_eq!(service.library_detail("99999999-9999-4999-8999-999999999999").unwrap().source_title.as_deref(),Some(request.desired.title.as_str()));
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
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
