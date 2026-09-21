// Included in auth_tests; exercises the typed native service over real SQLite.
#[test]
fn upload_acceptance_keeps_overlay_until_current_download() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let directory = std::env::temp_dir().join(format!("pr0-upload-{}", uuid::Uuid::new_v4()));
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
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    transport.0.lock().unwrap().extend([
        fixtures()["capabilities"].clone(),
        fixtures()["session"].clone(),
        serde_json::from_str::<serde_json::Value>(include_str!(
            "../../../../packages/api-contract/src/upload-fixtures.json"
        ))
        .unwrap()["accepted"]
            .clone(),
    ]);
    let status = service.library_upload().unwrap();
    assert_eq!(status.awaiting_download, 1);
    assert_eq!(
        service.library_detail(&request.prompt_id).unwrap().content,
        request.desired.content
    );
    assert_eq!(
        service.library_pending().unwrap()[0].state,
        "accepted_awaiting_download"
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_unchanged_receipt_replays_after_an_unrelated_prompt_changed() {
    let directory = std::env::temp_dir().join(format!("pr0-noop-{}", uuid::Uuid::new_v4()));
    let service =
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    let mut request = save_request(&service);
    let first = service.library_create(request.clone()).unwrap();
    let mut other = request.clone();
    other.prompt_id = uuid::Uuid::new_v4().to_string();
    other.operation_id = uuid::Uuid::new_v4().to_string();
    service.library_create(other).unwrap();
    request.expected_local_revision = Some(
        service
            .library_editor(&request.prompt_id)
            .unwrap()
            .local_revision,
    );
    request.operation_id = uuid::Uuid::new_v4().to_string();
    let unchanged = service.library_edit(request.clone()).unwrap();
    let replay = service.library_edit(request).unwrap();
    assert_eq!(replay.local_revision, unchanged.local_revision);
    assert_eq!(replay.prompt.modified_at, first.prompt.modified_at);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_known_full_library_refuses_growth_but_allows_reduction_during_download() {
    use sha2::{Digest, Sha256};
    let mut data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let mut records: serde_json::Value =
        serde_json::from_str(data["pages"][0]["payload"].as_str().unwrap()).unwrap();
    records["organization"]["textBytes"] = json!(104857600);
    let payload = records.to_string();
    data["pages"][0]["payload"] = json!(payload);
    data["manifest"]["promptCount"] = json!(10000);
    data["manifest"]["pages"][0]["bytes"] = json!(payload.len());
    data["manifest"]["pages"][0]["digest"] =
        json!(format!("{:x}", Sha256::digest(payload.as_bytes())));
    let directory = std::env::temp_dir().join(format!("pr0-quota-{}", uuid::Uuid::new_v4()));
    let transport = approval();
    transport.0.lock().unwrap().pop();
    transport
        .0
        .lock()
        .unwrap()
        .extend([data["manifest"].clone(), data["pages"][0].clone()]);
    let service =
        AuthService::new(directory.clone(), transport, Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    assert_eq!(
        service
            .library_create(save_request(&service))
            .err()
            .as_deref(),
        Some("quota_exceeded")
    );
    let first = service
        .library_editor("66666666-6666-4666-8666-666666666666")
        .unwrap();
    let mut edit = save_request(&service);
    edit.prompt_id = first.prompt.id.clone();
    edit.expected_local_revision = Some(first.local_revision);
    edit.desired = super::local_contract::PromptText::from_prompt(&first.prompt);
    edit.desired.content = "x".repeat(1000);
    assert_eq!(
        service.library_edit(edit.clone()).err().as_deref(),
        Some("quota_exceeded")
    );
    edit.desired.content = "x".into();
    service.library_edit(edit).unwrap();
    assert_eq!(
        service.library_detail(&first.prompt.id).unwrap().content,
        "x"
    );
    let pending = service.library_pending().unwrap();
    assert_eq!(pending[0].payload["base"]["content"], "  Hello offline\n");
    assert_eq!(pending[0].payload["baseRevision"], "1");
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn offline_download_and_old_receipt_cannot_replace_a_saved_successor() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let directory = std::env::temp_dir().join(format!("pr0-overlay-{}", uuid::Uuid::new_v4()));
    let transport = approval();
    transport.0.lock().unwrap().pop();
    transport.0.lock().unwrap().extend([
        data["manifest"].clone(),
        data["pages"][0].clone(),
        data["pages"][1].clone(),
    ]);
    let service =
        AuthService::new(directory.clone(), transport, Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    let first = service
        .library_editor("66666666-6666-4666-8666-666666666666")
        .unwrap();
    let mut request = save_request(&service);
    request.prompt_id = first.prompt.id.clone();
    request.expected_local_revision = Some(first.local_revision);
    let earlier = request.clone();
    let saved = service.library_edit(request.clone()).unwrap();
    request.expected_local_revision = Some(saved.local_revision);
    request.operation_id = uuid::Uuid::new_v4().to_string();
    request.desired.content = "Keep successor".into();
    service.library_edit(request).unwrap();
    assert!(service.library_download().unwrap().complete);
    assert_eq!(
        service.library_edit(earlier).err().as_deref(),
        Some("save_superseded")
    );
    assert_eq!(
        service.library_detail(&first.prompt.id).unwrap().content,
        "Keep successor"
    );
    assert_eq!(
        service.library_pending().unwrap()[0].payload["base"]["content"],
        "  Hello offline\n"
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn offline_native_validation_matches_shared_rest_fixtures() {
    let fixtures: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/local-save-fixtures.json"
    ))
    .unwrap();
    // serde rejects an unpaired surrogate before a typed command can run.
    assert!(serde_json::from_str::<super::local_contract::PromptText>(
        r#"{"title":"\uD800","description":"","content":"x"}"#
    )
    .is_err());
    let directory = std::env::temp_dir().join(format!("pr0-validation-{}", uuid::Uuid::new_v4()));
    let service =
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    for fixture in fixtures {
        if fixture["invalidScalar"].is_number() {
            continue;
        }
        let mut input = serde_json::to_value(save_request(&service)).unwrap();
        input["operationId"] = json!(uuid::Uuid::new_v4());
        input["promptId"] = json!(uuid::Uuid::new_v4());
        input["desired"][fixture["field"].as_str().unwrap()] = json!(fixture["value"]
            .as_str()
            .unwrap()
            .repeat(fixture["repeat"].as_u64().unwrap() as usize));
        let result = service.library_create(serde_json::from_value(input).unwrap());
        assert_eq!(
            result.is_ok(),
            fixture["valid"].as_bool().unwrap(),
            "{fixture}"
        );
    }
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn offline_successor_preserves_frozen_payload_and_dependencies() {
    let directory = std::env::temp_dir().join(format!("pr0-successor-{}", uuid::Uuid::new_v4()));
    let service =
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    let mut request = save_request(&service);
    let first = service.library_create(request.clone()).unwrap();
    let frozen = service.library_pending().unwrap().remove(0).payload;
    // Fixture at the future network boundary: the coordinator has persisted its handoff.
    let db = rusqlite::Connection::open(
        super::library_storage::library_path(&directory, &request.instance_id, &request.account_id)
            .unwrap(),
    )
    .unwrap();
    db.execute("UPDATE outbox SET state='in_flight'", [])
        .unwrap();
    drop(db);
    request.expected_local_revision = Some(first.local_revision);
    request.operation_id = uuid::Uuid::new_v4().to_string();
    request.desired.content = "Successor must survive".into();
    service.library_edit(request.clone()).unwrap();
    let pending = service.library_pending().unwrap();
    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].payload, frozen);
    assert_eq!(
        pending[1].payload["dependsOn"],
        json!([frozen["operationId"]])
    );
    assert_eq!(
        pending[1].payload["base"]["content"],
        "  My complete draft\n"
    );
    assert_eq!(
        pending[1].payload["desired"]["content"],
        "Successor must survive"
    );
    assert_eq!(pending[1].payload["changedFields"], json!(["content"]));
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
fn save_request(service: &AuthService) -> super::local_contract::SaveRequest {
    serde_json::from_value(json!({
        "instanceId":"11111111-1111-4111-8111-111111111111",
        "accountId":"33333333-3333-4333-8333-333333333333",
        "generation":view(service)["generation"],
        "operationId":"77777777-7777-4777-8777-777777777777",
        "promptId":"88888888-8888-4888-8888-888888888888",
        "expectedLocalRevision":null,
        "desired":{"title":"Offline","description":"Notes","content":"  My complete draft\n"}
    }))
    .unwrap()
}

#[test]
fn offline_storage_failures_never_acknowledge_and_uncertain_retry_is_once_only() {
    for fault in ["disk_full", "io_error", "after_commit_error"] {
        let directory =
            std::env::temp_dir().join(format!("pr0-fault-test-{}", uuid::Uuid::new_v4()));
        let vault = Arc::new(Vault::default());
        let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
        sign_in(&service);
        service.library_status().unwrap();
        let mut request = save_request(&service);
        request.desired.content = "x".repeat(262_144);
        super::library_storage::set_test_fault(fault);
        assert!(service.library_create(request.clone()).is_err(), "{fault}");
        super::library_storage::set_test_fault("");
        assert_eq!(
            service.library_status().unwrap().pending_changes,
            u32::from(fault == "after_commit_error")
        );
        let saved = service.library_create(request.clone()).unwrap();
        assert_eq!(saved.prompt.content.len(), 262_144);
        assert_eq!(service.library_status().unwrap().pending_changes, 1);
        drop(service);
        let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
        request.generation = view(&reopened)["generation"].as_u64().unwrap();
        reopened.library_create(request).unwrap();
        assert_eq!(reopened.library_pending().unwrap().len(), 1);
        drop(reopened);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[test]
fn offline_command_worker() {
    use std::io::{BufRead, Write};
    let Ok(directory) = std::env::var("PR0_LOCAL_TEST_DIRECTORY") else {
        return;
    };
    let directory = std::path::PathBuf::from(directory);
    let vault = Arc::new(Vault::default());
    let organization_capacity = std::env::var("PR0_ORGANIZATION_CAPACITY").as_deref() == Ok("true");
    let upload_fixture_enabled = std::env::var("PR0_UPLOAD_UI_FIXTURE").as_deref() == Ok("true");
    let recovery_fixture_enabled = std::env::var("PR0_RECOVERY_UI_FIXTURE").as_deref() == Ok("true");
    let search_fixture_enabled = std::env::var_os("PR0_SEARCH_FIXTURE_DIRECTORY").is_some();
    let recovery_transport = approval();
    if recovery_fixture_enabled {
        let data: serde_json::Value = serde_json::from_str(include_str!("../../../../packages/api-contract/src/snapshot-fixtures.json")).unwrap();
        recovery_transport.0.lock().unwrap().pop();
        recovery_transport.0.lock().unwrap().extend([data["manifest"].clone(), data["pages"][0].clone(), data["pages"][1].clone()]);
    }
    let transport: Arc<dyn Transport> = if organization_capacity {
        organization_capacity_transport()
    } else if recovery_fixture_enabled {
        recovery_transport.clone()
    } else if upload_fixture_enabled {
        upload_fixture(true, false)
    } else {
        approval()
    };
    let transport: Arc<dyn Transport> = match std::env::var("PR0_SEARCH_FIXTURE_DIRECTORY") {
        Ok(directory)=>Arc::new(SearchFixtureTransport{directory:directory.into(),fallback:transport}),
        Err(_)=>transport,
    };
    let service = AuthService::new(directory, transport, vault).unwrap();
    if view(&service)["state"] == "signed_out" {
        sign_in(&service);
    }
    if (upload_fixture_enabled || organization_capacity || recovery_fixture_enabled)
        && !service.library_status().unwrap().complete
    {
        service.library_download().unwrap();
        service.library_download().unwrap();
    }
    println!("READY:{}", view(&service)["generation"]);
    std::io::stdout().flush().unwrap();
    for line in std::io::stdin().lock().lines() {
        let input: serde_json::Value = serde_json::from_str(&line.unwrap()).unwrap();
        if input["command"] == "quit" {
            break;
        }
        let result: Result<serde_json::Value, String> = match input["command"].as_str().unwrap() {
            "auth_status" => service.status().map(|v| json!(v)),
            "auth_sign_out" => serde_json::from_value(input["request"].clone())
                .map_err(|_| "invalid_transition".to_string())
                .and_then(|request| service.transition(request))
                .map(|v| json!(v)),
            "library_status" => service.library_status().map(|v| json!(v)),
            "library_lifecycle" => {
                super::library_storage::set_test_fault(input["fault"].as_str().unwrap_or(""));
                let result = service.library_lifecycle(serde_json::from_value(input["request"].clone()).unwrap()).map(|v|json!(v));
                super::library_storage::set_test_fault("");
                result
            },
            "library_retained_prompt" => service.library_retained_prompt(input["id"].as_str().unwrap()).map(|v|json!(v)),
            "library_recover" => service.library_recover(serde_json::from_value(input["request"].clone()).unwrap()).map(|v|json!(v)),
            "library_list" => service.library_list(input["offset"].as_u64().unwrap_or(0) as u32,serde_json::from_value(input["view"].clone()).unwrap()).map(|v|json!(v)),
            "library_download" if recovery_fixture_enabled || search_fixture_enabled => service.library_download().map(|v|json!(v)),
            "library_search" => serde_json::from_value(input["request"].clone()).map_err(|_|"invalid_input".to_string()).and_then(|request| service.library_search(request)).map(|v|json!(v)),
            "library_cancel_search" => service.cancel_search(input["id"].as_str().unwrap()).map(|_|json!(null)),
            "library_recover_search" => serde_json::from_value(input["request"].clone()).map_err(|_|"invalid_input".to_string()).and_then(|request| service.library_recover_search(request)).map(|_|json!(null)),
            "library_reconcile" => service.library_reconcile().map(|_| serde_json::Value::Null),
            "library_organization" => service.library_organization(),
            "library_organize" => serde_json::from_value(input["request"].clone())
                .map_err(|_| "invalid_input".to_string())
                .and_then(|r| service.library_organize(r)),
            "library_organization_impact" => serde_json::from_value(input["action"].clone())
                .map_err(|_| "invalid_input".to_string())
                .and_then(|r| {
                    service.library_organization_impact(
                        r,
                        input["replaces"].as_str().map(str::to_owned),
                    )
                }),
            "library_organization_browse" => serde_json::from_value(input["request"].clone())
                .map_err(|_| "invalid_input".to_string())
                .and_then(|r| service.library_organization_browse(r))
                .map(|v| json!(v)),
            "library_organization_review" => service.library_organization_review(
                input["id"].as_str().unwrap(),
                input["offset"].as_u64().unwrap_or(0) as u32,
            ),
            "test_recovery" => {
                let mut data = replacement_fixture();
                data["manifest"]["epoch"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
                let mut changes = change_fixture();
                changes["epoch"] = data["manifest"]["epoch"].clone();
                recovery_transport.0.lock().unwrap().extend([json!({"fixtureFailure":"snapshot_required"}), data["manifest"].clone(), data["pages"][0].clone(), data["pages"][1].clone(), changes]);
                service.library_changes(0).unwrap();
                service.library_pause_download(true).map(|v|json!(v))
            }
            "library_pause_download" => service.library_pause_download(input["paused"].as_bool().unwrap()).map(|v|json!(v)),
            "library_recovery_browse" => service.library_recovery_browse(input["offset"].as_u64().unwrap_or(0) as u32).map(|v|json!(v)),
            "library_recovery_detail" => service.library_recovery_detail(input["snapshotId"].as_str().unwrap(), input["id"].as_str().unwrap()).map(|v|json!(v)),
            "library_browse" => service
                .library_browse(input["offset"].as_u64().unwrap_or(0) as u32)
                .map(|v| json!(v)),
            "library_detail" => service
                .library_detail(input["id"].as_str().unwrap())
                .map(|v| json!(v)),
            "library_editor" => service
                .library_editor(input["id"].as_str().unwrap())
                .map(|v| json!(v)),
            "library_create" | "library_edit" => {
                super::library_storage::set_test_fault(input["fault"].as_str().unwrap_or(""));
                let request = serde_json::from_value(input["request"].clone()).unwrap();
                let result = if input["command"] == "library_create" {
                    service.library_create(request)
                } else {
                    service.library_edit(request)
                };
                super::library_storage::set_test_fault("");
                result.map(|v| json!(v))
            }
            "library_pending" => service.library_pending().map(|v| json!(v)),
            "library_upload_status" => service.library_upload_status().map(|v| json!(v)),
            "library_change_status" => service.library_change_status().map(|v| json!(v)),
            "library_changes" => service.library_changes(0).map(|v| json!(v)),
            "library_sync" => {
                service.wake_sync();
                Ok(json!(null))
            }
            "library_upload" => service.library_upload().map(|v| json!(v)),
            "library_copy_draft" => service
                .copy_draft(
                    input["instanceId"].as_str().unwrap(),
                    input["accountId"].as_str().unwrap(),
                    input["generation"].as_u64().unwrap(),
                    input["text"].as_str().unwrap(),
                    |_| Ok(()),
                )
                .map(|_| json!(null)),
            "library_copy"
            | "library_recents"
            | "library_usage_status"
            | "library_retry_usage"
            | "test_clipboard_text" => usage_test_command(&service, &input),
            _ => Err("network_unavailable".into()),
        };
        println!("RESULT:{}", serde_json::to_string(&result).unwrap());
        std::io::stdout().flush().unwrap();
    }
}

#[test]
fn offline_controlled_process_kill_preserves_atomic_save() {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};
    for stage in ["after_projection", "before_commit", "after_commit"] {
        let directory =
            std::env::temp_dir().join(format!("pr0-kill-test-{}", uuid::Uuid::new_v4()));
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "auth_tests::offline_command_worker",
                "--nocapture",
            ])
            .env("PR0_LOCAL_TEST_DIRECTORY", &directory)
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
        let request = json!({"command":"library_create","request":{
            "instanceId":"11111111-1111-4111-8111-111111111111","accountId":"33333333-3333-4333-8333-333333333333","generation":generation,
            "operationId":"77777777-7777-4777-8777-777777777777","promptId":"88888888-8888-4888-8888-888888888888","expectedLocalRevision":null,
            "desired":{"title":"Killed write","description":"","content":"Retain exactly\n"}}});
        writeln!(child.stdin.as_mut().unwrap(), "{request}").unwrap();
        loop {
            line.clear();
            assert!(
                output.read_line(&mut line).unwrap() > 0,
                "worker quit at {stage}"
            );
            if line.trim() == format!("PAUSED:{stage}") {
                break;
            }
            assert!(!line.starts_with("RESULT:"), "{line}");
        }
        child.kill().unwrap();
        child.wait().unwrap();
        let reopened =
            AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap();
        assert_eq!(
            reopened.library_status().unwrap().pending_changes,
            u32::from(stage == "after_commit")
        );
        assert_eq!(
            reopened.library_browse(0).unwrap().len(),
            usize::from(stage == "after_commit")
        );
        if stage == "after_commit" {
            assert_eq!(
                reopened
                    .library_detail("88888888-8888-4888-8888-888888888888")
                    .unwrap()
                    .content,
                "Retain exactly\n"
            );
        }
        drop(reopened);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
