use super::auth::*;
use serde_json::json;
use std::sync::{Arc, Mutex};
include!("local_tests.rs");
include!("upload_tests.rs");
include!("change_tests.rs");
include!("recovery_tests.rs");
include!("usage_tests.rs");
include!("transition_tests.rs");
include!("compatibility_tests.rs");
include!("migration_tests.rs");
include!("search_tests.rs");
include!("search_fixture_transport.rs");
#[cfg(feature = "search-webview-test")]
include!("search_webview_tests.rs");
include!("organization_tests.rs");
include!("deletion_tests.rs");

fn fixtures() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/device-fixtures.json"
    ))
    .unwrap()
}
fn approval() -> Arc<Fixture> {
    let data = fixtures();
    Arc::new(Fixture(Mutex::new(vec![
        data["capabilities"].clone(),
        data["code"].clone(),
        data["token"].clone(),
        data["session"].clone(),
        json!({"success":true}),
    ])))
}
fn view(service: &AuthService) -> serde_json::Value {
    serde_json::to_value(service.status().unwrap()).unwrap()
}
fn sign_in(service: &AuthService) {
    service.begin("https://instance.example").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1050));
    service.poll().unwrap();
    assert_eq!(view(service)["state"], "signed_in");
    let rendered = serde_json::to_string(&service.status().unwrap()).unwrap();
    assert!(!rendered.contains("fixture-session-secret-only"));
    assert!(!rendered.contains("fixture-device-code-only"));
}

#[test]
fn offline_save_reopens_exact_text_and_pending_work_and_prevents_sign_out() {
    let directory = std::env::temp_dir().join(format!("pr0-save-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    sign_in(&service);
    let request: super::local_contract::SaveRequest = serde_json::from_value(json!({
        "instanceId": fixtures()["session"]["instance"]["id"],
        "accountId": fixtures()["session"]["account"]["id"],
        "generation": view(&service)["generation"],
        "operationId": "77777777-7777-4777-8777-777777777777",
        "promptId": "88888888-8888-4888-8888-888888888888",
        "expectedLocalRevision": null,
        "desired": {"title":"  Offline  ", "description":"  Notes  ", "content":"  My complete draft\n"}
    })).unwrap();
    let saved = service.library_create(request.clone()).unwrap();
    assert_eq!(saved.prompt.title, "Offline");
    assert_eq!(saved.prompt.content, "  My complete draft\n");
    assert_eq!(
        service.library_create(request).unwrap().local_revision,
        saved.local_revision
    );
    assert_eq!(service.sign_out().err().as_deref(), Some("pending_work"));
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(
        reopened.library_detail(&saved.prompt.id).unwrap().content,
        "  My complete draft\n"
    );
    assert_eq!(reopened.library_status().unwrap().pending_changes, 1);
    assert_eq!(reopened.library_browse(0).unwrap()[0].title, "Offline");
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn offline_edit_rejects_stale_window_and_unchanged_save_keeps_dates() {
    use super::local_contract::{PromptText, SaveRequest};
    let directory = std::env::temp_dir().join(format!("pr0-edit-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), approval(), vault).unwrap();
    sign_in(&service);
    let mut request = SaveRequest {
        instance_id: "11111111-1111-4111-8111-111111111111".into(),
        account_id: "33333333-3333-4333-8333-333333333333".into(),
        generation: view(&service)["generation"].as_u64().unwrap(),
        operation_id: uuid::Uuid::new_v4().to_string(),
        prompt_id: uuid::Uuid::new_v4().to_string(),
        expected_local_revision: None,
        desired: PromptText {
            title: "Draft".into(),
            description: "".into(),
            content: "First".into(),
        },
    };
    let first = service.library_create(request.clone()).unwrap();
    request.expected_local_revision = Some(first.local_revision.clone());
    request.operation_id = uuid::Uuid::new_v4().to_string();
    let unchanged = service.library_edit(request.clone()).unwrap();
    assert_eq!(unchanged.local_revision, first.local_revision);
    assert_eq!(unchanged.prompt.modified_at, first.prompt.modified_at);
    request.operation_id = uuid::Uuid::new_v4().to_string();
    request.desired.content = "Second".into();
    let changed = service.library_edit(request.clone()).unwrap();
    assert_ne!(changed.local_revision, first.local_revision);
    let mut stale = request.clone();
    stale.operation_id = uuid::Uuid::new_v4().to_string();
    stale.desired.content = "Other window complete draft".into();
    assert_eq!(
        service.library_edit(stale).err().as_deref(),
        Some("local_revision_conflict")
    );
    assert_eq!(
        service
            .library_editor(&request.prompt_id)
            .unwrap()
            .prompt
            .content,
        "Second"
    );
    assert_eq!(service.library_status().unwrap().pending_changes, 1);
    let pending = service.library_pending().unwrap();
    assert_eq!(pending[0].payload["kind"], "prompt.create");
    assert_eq!(pending[0].payload["desired"]["content"], "Second");
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn partial_library_survives_restart_and_completes_through_native_commands() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let directory = std::env::temp_dir().join(format!("pr0-library-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let transport = approval();
    transport.0.lock().unwrap().pop();
    transport
        .0
        .lock()
        .unwrap()
        .extend([data["manifest"].clone(), data["pages"][0].clone()]);
    let service = AuthService::new(directory.clone(), transport, vault.clone()).unwrap();
    sign_in(&service);
    let status = service.library_download().unwrap();
    assert!(!status.complete);
    assert_eq!(status.downloaded, 1);
    drop(service);
    let transport = Arc::new(Fixture(Mutex::new(vec![data["pages"][1].clone()])));
    let reopened = AuthService::new(directory.clone(), transport, vault).unwrap();
    assert_eq!(reopened.library_browse(0).unwrap().len(), 1);
    assert_eq!(
        reopened
            .library_detail("66666666-6666-4666-8666-666666666666")
            .unwrap()
            .content,
        "  Hello offline\n"
    );
    assert!(reopened.library_download().unwrap().complete);
    assert_eq!(reopened.library_browse(0).unwrap().len(), 2);
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn invalid_page_preserves_downloaded_prompts_and_sign_out_cleans_only_its_partition() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let directory = std::env::temp_dir().join(format!("pr0-library-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let transport = approval();
    transport.0.lock().unwrap().pop();
    let mut corrupt = data["pages"][1].clone();
    corrupt["payload"] = json!("tampered");
    transport.0.lock().unwrap().extend([
        data["manifest"].clone(),
        data["pages"][0].clone(),
        corrupt,
        json!({"success":true}),
    ]);
    let service = AuthService::new(directory.clone(), transport, vault.clone()).unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    assert_eq!(
        service.library_download().err().as_deref(),
        Some("snapshot_digest_mismatch")
    );
    assert_eq!(service.library_browse(0).unwrap().len(), 1);
    assert!(!service.library_status().unwrap().complete);
    service.sign_out().unwrap();
    assert!(service.library_browse(0).is_err());
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(view(&reopened)["state"], "signed_out");
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn persistent_sign_in_reopens_and_missing_credentials_preserve_identity_and_files() {
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    sign_in(&service);
    drop(service);
    let restored_transport = Arc::new(Fixture(Mutex::new(vec![fixtures()["session"].clone()])));
    let reopened = AuthService::new(directory.clone(), restored_transport, vault.clone()).unwrap();
    assert_eq!(
        serde_json::to_value(reopened.restore().unwrap()).unwrap()["state"],
        "signed_in"
    );
    // Only the first command checks restoration; subsequent status reads stay local.
    assert_eq!(
        serde_json::to_value(reopened.restore().unwrap()).unwrap()["state"],
        "signed_in"
    );
    drop(reopened);
    vault.delete().unwrap();
    std::fs::write(directory.join("retained-library.sqlite"), b"retained work").unwrap();
    let missing = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    assert_eq!(view(&missing)["state"], "authentication_required");
    assert_eq!(
        view(&missing)["accountId"],
        "33333333-3333-4333-8333-333333333333"
    );
    assert_eq!(
        missing.sign_out().err().as_deref(),
        Some("local_data_requires_review")
    );
    assert_eq!(
        std::fs::read(directory.join("retained-library.sqlite")).unwrap(),
        b"retained work"
    );
    drop(missing);
    vault.write(b"corrupt").unwrap();
    let corrupt = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(view(&corrupt)["state"], "authentication_required");
    drop(corrupt);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn credential_failure_never_declares_persistent_sign_in() {
    struct FailingVault;
    impl Credentials for FailingVault {
        fn read(&self) -> Result<Option<Vec<u8>>, String> {
            Err("credential_unavailable".into())
        }
        fn write(&self, _: &[u8]) -> Result<(), String> {
            Err("credential_unavailable".into())
        }
        fn delete(&self) -> Result<(), String> {
            Err("credential_unavailable".into())
        }
    }
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let service = AuthService::new(directory.clone(), approval(), Arc::new(FailingVault)).unwrap();
    service.begin("https://instance.example").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1050));
    assert_eq!(
        service.poll().err().as_deref(),
        Some("credential_unavailable")
    );
    assert_eq!(view(&service)["state"], "authentication_required");
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn logout_removes_only_this_desktop_credential_and_can_restart() {
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    sign_in(&service);
    service.sign_out().unwrap();
    assert!(vault.read().unwrap().is_none());
    assert_eq!(view(&service)["state"], "signed_out");
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(view(&reopened)["state"], "signed_out");
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn malformed_sign_out_responses_never_confirm_remote_revocation() {
    for response in [
        json!({}),
        json!(null),
        json!({"success":false}),
        json!({"success":true,"extra":1}),
    ] {
        let directory =
            std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
        let transport = approval();
        *transport.0.lock().unwrap().last_mut().unwrap() = response;
        let vault = Arc::new(Vault::default());
        let service = AuthService::new(directory.clone(), transport, vault.clone()).unwrap();
        sign_in(&service);
        service.sign_out().unwrap();
        assert_eq!(view(&service)["state"], "signed_out");
        assert!(view(&service)["message"]
            .as_str()
            .unwrap()
            .contains("could not be confirmed"));
        assert!(vault.read().unwrap().is_none());
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[test]
fn expired_saved_session_requests_login_without_discarding_identity() {
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    sign_in(&service);
    drop(service);
    let storage = super::auth_storage::Metadata::open(&directory).unwrap();
    let mut retained = storage.read().unwrap().unwrap();
    retained.identity.session.expires_at = "2000-01-01T00:00:00.000Z".into();
    storage.save(&retained).unwrap();
    drop(storage);
    let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(view(&reopened)["state"], "authentication_required");
    assert_eq!(
        view(&reopened)["accountId"],
        "33333333-3333-4333-8333-333333333333"
    );
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[cfg(windows)]
#[test]
fn windows_credential_survives_new_process() {
    use super::auth_storage::WindowsCredentials;
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let target = format!("pr0:test:39:{}", uuid::Uuid::new_v4());
    let vault = Arc::new(WindowsCredentials::new(target.clone()));
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    sign_in(&service);
    drop(service);
    let result = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "auth_tests::restart_worker"])
        .env("PR0_TEST_RESTART_PATH", &directory)
        .env("PR0_TEST_CREDENTIAL_TARGET", &target)
        .status();
    vault.delete().unwrap();
    std::fs::remove_dir_all(directory).unwrap();
    assert!(result.unwrap().success());
}

#[cfg(windows)]
#[test]
fn restart_worker() {
    use super::auth_storage::WindowsCredentials;
    let Ok(path) = std::env::var("PR0_TEST_RESTART_PATH") else {
        return;
    };
    let target = std::env::var("PR0_TEST_CREDENTIAL_TARGET").unwrap();
    let service = AuthService::new(
        path.into(),
        approval(),
        Arc::new(WindowsCredentials::new(target.clone())),
    )
    .unwrap();
    assert_eq!(view(&service)["state"], "signed_in");
}

#[test]
fn late_redemption_after_cancel_cannot_store_credentials() {
    struct RacingTransport {
        entered: std::sync::Barrier,
        release: std::sync::Barrier,
    }
    impl Transport for RacingTransport {
        fn request(
            &self,
            _: &str,
            endpoint: Endpoint,
            _: Option<&str>,
            _: Option<serde_json::Value>,
        ) -> Result<serde_json::Value, String> {
            let data = fixtures();
            Ok(match endpoint {
                Endpoint::DeletionLookup => json!({"status":"absent"}),
                Endpoint::Capabilities => data["capabilities"].clone(),
                Endpoint::Code => data["code"].clone(),
                Endpoint::Token => {
                    self.entered.wait();
                    self.release.wait();
                    data["token"].clone()
                }
                Endpoint::Session => data["session"].clone(),
                _ => json!({"success":true}),
            })
        }
        fn open_browser(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
    }
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let transport = Arc::new(RacingTransport {
        entered: std::sync::Barrier::new(2),
        release: std::sync::Barrier::new(2),
    });
    let vault = Arc::new(Vault::default());
    let service =
        Arc::new(AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap());
    service.begin("https://instance.example").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1050));
    let pending = service.clone();
    let worker = std::thread::spawn(move || pending.poll());
    transport.entered.wait();
    service.cancel().unwrap();
    transport.release.wait();
    assert_eq!(
        worker.join().unwrap().err().as_deref(),
        Some("operation_cancelled")
    );
    assert_eq!(view(&service)["state"], "signed_out");
    assert!(vault.read().unwrap().is_none());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn expired_approval_returns_to_sign_in() {
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let mut data = fixtures();
    data["code"]["expires_in"] = json!(1);
    let transport = Arc::new(Fixture(Mutex::new(vec![
        data["capabilities"].clone(),
        data["code"].clone(),
    ])));
    let service =
        AuthService::new(directory.clone(), transport, Arc::new(Vault::default())).unwrap();
    service.begin("https://instance.example").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1050));
    service.poll().unwrap();
    assert_eq!(view(&service)["state"], "signed_out");
    assert!(view(&service)["message"]
        .as_str()
        .unwrap()
        .contains("expired"));
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn reauthentication_rejects_a_different_account_without_replacing_retained_identity() {
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    sign_in(&service);
    drop(service);
    vault.delete().unwrap();
    let mut data = fixtures();
    data["session"]["account"]["id"] = json!("55555555-5555-4555-8555-555555555555");
    let transport = Arc::new(Fixture(Mutex::new(vec![
        data["capabilities"].clone(),
        data["code"].clone(),
        data["token"].clone(),
        data["session"].clone(),
    ])));
    let service = AuthService::new(directory.clone(), transport, vault.clone()).unwrap();
    service.begin("https://instance.example").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1050));
    assert_eq!(
        service.poll().err().as_deref(),
        Some("same_account_required")
    );
    assert_eq!(
        view(&service)["accountId"],
        "33333333-3333-4333-8333-333333333333"
    );
    assert!(vault.read().unwrap().is_none());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[cfg(windows)]
#[test]
fn live_https_worker() {
    use super::auth_storage::WindowsCredentials;
    use super::auth_transport::HttpsTransport;
    use std::io::{BufRead, Write};
    let Ok(path) = std::env::var("PR0_TEST_LIVE_PATH") else {
        return;
    };
    struct BrowserBoundary(HttpsTransport);
    impl Transport for BrowserBoundary {
        fn changes(
            &self,
            origin: &str,
            token: &str,
            body: serde_json::Value,
            cancelled: &(dyn Fn() -> bool + Sync),
        ) -> Result<serde_json::Value, String> {
            self.0.changes(origin, token, body, cancelled)
        }
        fn request(
            &self,
            origin: &str,
            endpoint: Endpoint,
            token: Option<&str>,
            body: Option<serde_json::Value>,
        ) -> Result<serde_json::Value, String> {
            self.0.request(origin, endpoint, token, body)
        }
        fn open_browser(&self, url: &str) -> Result<(), String> {
            // The external test controller opens this exact URL in isolated Chrome.
            println!("PR0_BROWSER:{url}");
            Ok(())
        }
    }
    let target = std::env::var("PR0_TEST_CREDENTIAL_TARGET").unwrap();
    let certificate = std::fs::read(std::env::var("PR0_TEST_CERTIFICATE").unwrap()).unwrap();
    let service = AuthService::new(
        path.into(),
        Arc::new(BrowserBoundary(
            HttpsTransport::with_test_root(&certificate).unwrap(),
        )),
        Arc::new(WindowsCredentials::new(target.clone())),
    )
    .unwrap();
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap();
        let input: serde_json::Value = serde_json::from_str(&line).unwrap();
        let command = input["command"].as_str().unwrap();
        if command == "quit" {
            break;
        }
        let result = match command {
            "test_clear_credential" => WindowsCredentials::new(target.clone())
                .delete()
                .map(|_| json!(null)),
            "status" => service.restore().map(|value| json!(value)),
            "begin" => service
                .begin(input["origin"].as_str().unwrap())
                .map(|value| json!(value)),
            "poll" => service.poll().map(|value| json!(value)),
            "sign_out" => service.sign_out().map(|value| json!(value)),
            "refresh" => service.refresh().map(|value| json!(value)),
            "auth_sign_out" => service
                .transition(serde_json::from_value(input["request"].clone()).unwrap())
                .map(|value| json!(value)),
            "library_status" => service.library_status().map(|value| json!(value)),
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
            "library_download" => service.library_download().map(|value| json!(value)),
            "library_recovery_browse" => service
                .library_recovery_browse(input["offset"].as_u64().unwrap_or(0) as u32)
                .map(|v| json!(v)),
            "library_recovery_detail" => service
                .library_recovery_detail(
                    input["snapshotId"].as_str().unwrap(),
                    input["id"].as_str().unwrap(),
                )
                .map(|v| json!(v)),
            "library_upload_status" => service.library_upload_status().map(|v| json!(v)),
            "library_change_status" => service.library_change_status().map(|v| json!(v)),
            "library_sync" => {
                service.wake_sync();
                Ok(json!(null))
            }
            "library_upload" => service.library_upload().map(|v| json!(v)),
            "library_changes" => service.library_changes(0).map(|v| json!(v)),
            "library_poll_changes" => service.library_changes(25).map(|v| json!(v)),
            "library_interrupt_changes" => std::thread::scope(|scope| {
                scope.spawn(|| {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                    service.wake_sync();
                });
                service.library_changes(25).map(|v| json!(v))
            }),
            "library_editor" => service
                .library_editor(input["id"].as_str().unwrap())
                .map(|v| json!(v)),
            "library_create" => service
                .library_create(serde_json::from_value(input["request"].clone()).unwrap())
                .map(|v| json!(v)),
            "library_edit" => service
                .library_edit(serde_json::from_value(input["request"].clone()).unwrap())
                .map(|v| json!(v)),
            "library_browse" => service
                .library_browse(input["offset"].as_u64().unwrap_or(0) as u32)
                .map(|value| json!(value)),
            "library_detail" => service
                .library_detail(input["id"].as_str().unwrap())
                .map(|value| json!(value)),
            _ => usage_test_command(&service, &input),
        };
        println!("PR0_RESULT:{}", serde_json::to_string(&result).unwrap());
        std::io::stdout().flush().unwrap();
    }
}

#[test]
fn late_authenticated_response_after_logout_cannot_restore_the_account() {
    struct RacingSession {
        sessions: std::sync::atomic::AtomicUsize,
        entered: std::sync::Barrier,
        release: std::sync::Barrier,
    }
    impl Transport for RacingSession {
        fn request(
            &self,
            _: &str,
            endpoint: Endpoint,
            _: Option<&str>,
            _: Option<serde_json::Value>,
        ) -> Result<serde_json::Value, String> {
            let data = fixtures();
            Ok(match endpoint {
                Endpoint::DeletionLookup => json!({"status":"absent"}),
                Endpoint::Capabilities => data["capabilities"].clone(),
                Endpoint::Code => data["code"].clone(),
                Endpoint::Token => data["token"].clone(),
                Endpoint::Session => {
                    if self
                        .sessions
                        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                        > 0
                    {
                        self.entered.wait();
                        self.release.wait();
                    }
                    data["session"].clone()
                }
                _ => json!({"success":true}),
            })
        }
        fn open_browser(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
    }
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let transport = Arc::new(RacingSession {
        sessions: std::sync::atomic::AtomicUsize::new(0),
        entered: std::sync::Barrier::new(2),
        release: std::sync::Barrier::new(2),
    });
    let vault = Arc::new(Vault::default());
    let service =
        Arc::new(AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap());
    sign_in(&service);
    let pending = service.clone();
    let worker = std::thread::spawn(move || pending.refresh());
    transport.entered.wait();
    service.sign_out().unwrap();
    transport.release.wait();
    assert_eq!(
        worker.join().unwrap().err().as_deref(),
        Some("operation_cancelled")
    );
    assert_eq!(view(&service)["state"], "signed_out");
    assert!(vault.read().unwrap().is_none());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn known_revocation_survives_restart_without_erasing_retained_identity() {
    struct RevokedTransport;
    impl Transport for RevokedTransport {
        fn request(
            &self,
            _: &str,
            endpoint: Endpoint,
            _: Option<&str>,
            _: Option<serde_json::Value>,
        ) -> Result<serde_json::Value, String> {
            if matches!(endpoint, Endpoint::DeletionLookup) {
                return Ok(json!({"status":"absent"}));
            }
            Err("authentication_required".into())
        }
        fn open_browser(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
    }
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    sign_in(&service);
    drop(service);
    let service =
        AuthService::new(directory.clone(), Arc::new(RevokedTransport), vault.clone()).unwrap();
    assert_eq!(
        serde_json::to_value(service.restore().unwrap()).unwrap()["state"],
        "authentication_required"
    );
    drop(service);
    let service = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(view(&service)["state"], "authentication_required");
    assert_eq!(
        view(&service)["accountId"],
        "33333333-3333-4333-8333-333333333333"
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn concurrent_restore_waits_for_the_same_revocation_check() {
    struct BlockedRevocation {
        entered: std::sync::Barrier,
        release: std::sync::Barrier,
    }
    impl Transport for BlockedRevocation {
        fn request(
            &self,
            _: &str,
            endpoint: Endpoint,
            _: Option<&str>,
            _: Option<serde_json::Value>,
        ) -> Result<serde_json::Value, String> {
            if matches!(endpoint, Endpoint::DeletionLookup) {
                return Ok(json!({"status":"absent"}));
            }
            self.entered.wait();
            self.release.wait();
            Err("authentication_required".into())
        }
        fn open_browser(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
    }
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    sign_in(&service);
    drop(service);
    let transport = Arc::new(BlockedRevocation {
        entered: std::sync::Barrier::new(2),
        release: std::sync::Barrier::new(2),
    });
    let service = Arc::new(AuthService::new(directory.clone(), transport.clone(), vault).unwrap());
    let first = service.clone();
    let first = std::thread::spawn(move || first.restore().unwrap());
    transport.entered.wait();
    let second = service.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    let second = std::thread::spawn(move || sender.send(second.restore().unwrap()).unwrap());
    let early = receiver.recv_timeout(std::time::Duration::from_millis(100));
    transport.release.wait();
    let second_view = match early {
        Ok(view) => view,
        Err(_) => receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap(),
    };
    let first_view = first.join().unwrap();
    second.join().unwrap();
    assert_eq!(
        serde_json::to_value(first_view).unwrap()["state"],
        "authentication_required"
    );
    assert_eq!(
        serde_json::to_value(second_view).unwrap()["state"],
        "authentication_required"
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

struct Fixture(Mutex<Vec<serde_json::Value>>);

#[test]
fn shared_malformed_organization_pages_never_advance_durable_progress() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    for entry in data["malformed"].as_array().unwrap() {
        let directory =
            std::env::temp_dir().join(format!("pr0-library-test-{}", uuid::Uuid::new_v4()));
        let transport = approval();
        transport.0.lock().unwrap().pop();
        transport.0.lock().unwrap().push(entry["manifest"].clone());
        let page = entry["page"]["page"].as_u64().unwrap();
        if page == 1 {
            transport.0.lock().unwrap().push(data["pages"][0].clone());
        }
        transport.0.lock().unwrap().push(entry["page"].clone());
        let service =
            AuthService::new(directory.clone(), transport, Arc::new(Vault::default())).unwrap();
        sign_in(&service);
        if page == 1 {
            service.library_download().unwrap();
        }
        assert_eq!(
            service.library_download().err().as_deref(),
            Some("invalid_response"),
            "{}",
            entry["name"]
        );
        assert_eq!(service.library_status().unwrap().applied_pages, page as u32);
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[test]
fn manifest_authorization_failure_requires_sign_in_without_erasing_identity() {
    let directory = std::env::temp_dir().join(format!("pr0-library-test-{}", uuid::Uuid::new_v4()));
    let transport = approval();
    transport.0.lock().unwrap().pop();
    transport
        .0
        .lock()
        .unwrap()
        .push(json!({"fixtureFailure":"authentication_required"}));
    let service =
        AuthService::new(directory.clone(), transport, Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    assert_eq!(
        service.library_download().err().as_deref(),
        Some("authentication_required")
    );
    assert_eq!(view(&service)["state"], "authentication_required");
    assert_eq!(service.library_status().unwrap().downloaded, 0);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn expiry_and_offline_restart_preserve_the_prior_usable_download() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let directory = std::env::temp_dir().join(format!("pr0-library-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let transport = approval();
    transport.0.lock().unwrap().pop();
    transport.0.lock().unwrap().extend([
        data["manifest"].clone(),
        data["pages"][0].clone(),
        json!({"fixtureFailure":"network_unavailable"}),
    ]);
    let service = AuthService::new(directory.clone(), transport, vault.clone()).unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    assert_eq!(
        service.library_download().err().as_deref(),
        Some("network_unavailable")
    );
    drop(service);
    let mut fresh = data["manifest"].clone();
    fresh["id"] = json!("99999999-9999-4999-8999-999999999999");
    let mut first = data["pages"][0].clone();
    first["id"] = fresh["id"].clone();
    let mut second = data["pages"][1].clone();
    second["id"] = fresh["id"].clone();
    let transport = Arc::new(Fixture(Mutex::new(vec![
        json!({"fixtureFailure":"snapshot_expired"}),
        fresh,
        first,
        second,
        change_fixture(),
    ])));
    let reopened = AuthService::new(directory.clone(), transport, vault).unwrap();
    assert_eq!(reopened.library_browse(0).unwrap().len(), 1);
    assert_eq!(
        reopened.library_download().err().as_deref(),
        Some("snapshot_expired")
    );
    assert_eq!(reopened.library_browse(0).unwrap().len(), 1);
    assert!(!reopened.library_download().unwrap().complete);
    assert_eq!(reopened.library_browse(0).unwrap().len(), 1);
    assert!(!reopened.library_download().unwrap().complete);
    assert!(reopened.library_download().unwrap().complete);
    assert_eq!(reopened.library_browse(0).unwrap().len(), 2);
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn missing_credentials_and_another_accounts_manifest_cannot_replace_local_prompts() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let directory = std::env::temp_dir().join(format!("pr0-library-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let transport = approval();
    transport.0.lock().unwrap().pop();
    let mut foreign = data["manifest"].clone();
    foreign["accountId"] = json!("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    transport.0.lock().unwrap().extend([
        foreign,
        data["manifest"].clone(),
        data["pages"][0].clone(),
    ]);
    let service = AuthService::new(directory.clone(), transport, vault.clone()).unwrap();
    sign_in(&service);
    assert_eq!(
        service.library_download().err().as_deref(),
        Some("invalid_response")
    );
    assert!(service.library_browse(0).unwrap().is_empty());
    service.library_download().unwrap();
    drop(service);
    vault.delete().unwrap();
    let service = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(view(&service)["state"], "authentication_required");
    assert_eq!(service.library_browse(0).unwrap().len(), 1);
    assert_eq!(
        service.library_download().err().as_deref(),
        Some("authentication_required")
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn local_io_failure_does_not_acknowledge_a_page_or_erase_prior_prompts() {
    let data: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/snapshot-fixtures.json"
    ))
    .unwrap();
    let directory = std::env::temp_dir().join(format!("pr0-library-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let transport = approval();
    transport.0.lock().unwrap().pop();
    transport
        .0
        .lock()
        .unwrap()
        .extend([data["manifest"].clone(), data["pages"][0].clone()]);
    let service = AuthService::new(directory.clone(), transport, vault.clone()).unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    drop(service);
    // Inject a real filesystem write failure at the native storage boundary.
    let path = super::library_storage::library_path(
        &directory,
        "11111111-1111-4111-8111-111111111111",
        "33333333-3333-4333-8333-333333333333",
    )
    .unwrap();
    let original = std::fs::metadata(&path).unwrap().permissions();
    let mut blocked = original.clone();
    blocked.set_readonly(true);
    std::fs::set_permissions(&path, blocked).unwrap();
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    let failed = service.library_download();
    drop(service);
    std::fs::set_permissions(&path, original).unwrap();
    assert!(failed.is_err());
    let service = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(service.library_status().unwrap().applied_pages, 1);
    assert_eq!(
        service
            .library_detail("66666666-6666-4666-8666-666666666666")
            .unwrap()
            .content,
        "  Hello offline\n"
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
impl Transport for Fixture {
    fn request(
        &self,
        _: &str,
        endpoint: Endpoint,
        _: Option<&str>,
        _: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let mut responses = self.0.lock().unwrap();
        if matches!(endpoint, Endpoint::DeletionLookup)
            && !responses.first().is_some_and(|v| v.get("status").is_some())
        {
            return Ok(json!({"status":"absent"}));
        }
        if matches!(endpoint, Endpoint::DeletionVerification) {
            return Ok(
                json!({"instanceId": fixtures()["capabilities"]["instanceId"], "anchor": fixtures()["capabilities"]["deletionKey"], "rotations": []}),
            );
        }
        let value = responses.remove(0);
        if let Some(error) = value
            .get("fixtureFailure")
            .and_then(serde_json::Value::as_str)
        {
            return Err(error.into());
        }
        Ok(value)
    }
    fn open_browser(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}
#[derive(Default)]
struct Vault(Mutex<Option<Vec<u8>>>);
impl Credentials for Vault {
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn write(&self, bytes: &[u8]) -> Result<(), String> {
        *self.0.lock().unwrap() = Some(bytes.to_vec());
        Ok(())
    }
    fn delete(&self) -> Result<(), String> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

#[test]
fn commands_reject_untrusted_instance_urls_without_network_access() {
    let directory = std::env::temp_dir().join(format!("pr0-auth-test-{}", uuid::Uuid::new_v4()));
    let service = AuthService::new(
        directory.clone(),
        Arc::new(Fixture(Mutex::new(vec![]))),
        Arc::new(Vault::default()),
    )
    .unwrap();
    for url in [
        "http://example.com",
        "https://user:secret@example.com",
        "https://example.com/path",
        "https://example.com/?token=x",
    ] {
        assert!(service.begin(url).is_err());
    }
    assert_eq!(
        serde_json::to_value(service.status().unwrap()).unwrap()["state"],
        json!("signed_out")
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
