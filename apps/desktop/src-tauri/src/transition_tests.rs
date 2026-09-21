// Public native commands over real SQLite; transport and credentials are system boundaries.
#[test]
fn transition_shared_request_conformance() {
    let fixtures: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/transition-fixtures.json"
    ))
    .unwrap();
    for fixture in fixtures.as_array().unwrap() {
        let result = serde_json::from_value::<super::auth_contract::SignOutRequest>(
            fixture["request"].clone(),
        )
        .map_err(|e| e.to_string())
        .and_then(|request| request.validate());
        assert_eq!(
            result.is_ok(),
            fixture["valid"].as_bool().unwrap(),
            "{}",
            fixture["name"]
        );
    }
}
fn transition_request(
    service: &AuthService,
    choice: &str,
    confirmed: bool,
) -> super::auth_contract::SignOutRequest {
    serde_json::from_value(json!({
        "instanceId": view(service)["instanceId"],
        "accountId": view(service)["accountId"],
        "generation": view(service)["generation"],
        "choice": choice, "discardConfirmed": confirmed
    }))
    .unwrap()
}

#[test]
fn transition_cancel_and_unconfirmed_discard_preserve_pending_work() {
    let directory = std::env::temp_dir().join(format!("pr0-transition-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let transport = approval();
    *transport.0.lock().unwrap().last_mut().unwrap() =
        json!({"fixtureFailure":"network_unavailable"});
    let service = AuthService::new(directory.clone(), transport, vault.clone()).unwrap();
    sign_in(&service);
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    service
        .transition(transition_request(&service, "cancel", false))
        .unwrap();
    assert_eq!(service.library_status().unwrap().pending_changes, 1);
    assert_eq!(
        service
            .transition(transition_request(&service, "discard", false))
            .err()
            .as_deref(),
        Some("discard_confirmation_required")
    );
    assert_eq!(
        service.library_detail(&request.prompt_id).unwrap().content,
        request.desired.content
    );
    service
        .transition(transition_request(&service, "discard", true))
        .unwrap();
    assert_eq!(view(&service)["state"], "signed_out");
    assert!(view(&service)["message"]
        .as_str()
        .unwrap()
        .contains("could not be confirmed"));
    assert!(vault.read().unwrap().is_none());
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(view(&reopened)["state"], "signed_out");
    assert!(reopened.library_browse(0).is_err());
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn transition_synchronize_delivers_pending_work_before_cleanup() {
    let directory = std::env::temp_dir().join(format!("pr0-transition-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let transport = upload_fixture(false, false);
    let service = downloaded_upload_service(&directory, transport.clone(), vault.clone());
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    service
        .transition(transition_request(&service, "synchronize", false))
        .unwrap();
    assert_eq!(view(&service)["state"], "signed_out");
    assert_eq!(
        transport.traffic.lock().unwrap()[0].1["operations"][0]["desired"]["content"],
        request.desired.content
    );
    assert!(vault.read().unwrap().is_none());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn transition_cancel_invalidates_a_delayed_upload_without_losing_its_uncertain_operation() {
    let directory = std::env::temp_dir().join(format!("pr0-transition-{}", uuid::Uuid::new_v4()));
    let entered = Arc::new(std::sync::Barrier::new(2));
    let release = Arc::new(std::sync::Barrier::new(2));
    let transport = Arc::new(UploadFixture {
        traffic: Mutex::new(vec![]),
        lose: std::sync::atomic::AtomicBool::new(false),
        conflict: false,
        quota: false,
        failure: Mutex::new(None),
        entered: Some(entered.clone()),
        release: Some(release.clone()),
    });
    let vault = Arc::new(Vault::default());
    let service = Arc::new(downloaded_upload_service(
        &directory,
        transport.clone(),
        vault.clone(),
    ));
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    let worker = service.clone();
    let transition = transition_request(&service, "synchronize", false);
    let task = std::thread::spawn(move || worker.transition(transition));
    entered.wait();
    let cancelled = service.transition(transition_request(&service, "cancel", false));
    release.wait();
    let result = task.join().unwrap();
    cancelled.unwrap();
    assert_eq!(result.err().as_deref(), Some("operation_cancelled"));
    assert_eq!(view(&service)["state"], "signed_in");
    assert_eq!(
        service.library_detail(&request.prompt_id).unwrap().content,
        request.desired.content
    );
    assert_eq!(service.library_upload_status().unwrap().waiting, 1);
    drop(service);
    let reopened = AuthService::new(directory.clone(), transport.clone(), vault).unwrap();
    assert_eq!(reopened.library_upload().unwrap().waiting, 0);
    assert!(transport.traffic.lock().unwrap()[1].0);
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

struct FaultyCredential {
    vault: Vault,
    fail_write: std::sync::atomic::AtomicBool,
    fail_delete: std::sync::atomic::AtomicBool,
}
impl Credentials for FaultyCredential {
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        self.vault.read()
    }
    fn write(&self, bytes: &[u8]) -> Result<(), String> {
        self.vault.write(bytes)?;
        if self.fail_write.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("credential_unavailable".into());
        }
        Ok(())
    }
    fn delete(&self) -> Result<(), String> {
        if self.fail_delete.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("credential_unavailable".into());
        }
        self.vault.delete()
    }
}
#[test]
fn transition_failed_credential_confirmation_stays_incomplete_after_restart() {
    let directory = std::env::temp_dir().join(format!("pr0-transition-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(FaultyCredential {
        vault: Vault::default(),
        fail_write: true.into(),
        fail_delete: false.into(),
    });
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    service.begin("https://instance.example").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1050));
    assert_eq!(
        service.poll().err().as_deref(),
        Some("credential_unavailable")
    );
    assert_eq!(view(&service)["state"], "authentication_required");
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    assert_eq!(view(&reopened)["state"], "authentication_required");
    vault
        .fail_write
        .store(false, std::sync::atomic::Ordering::SeqCst);
    sign_in(&reopened);
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn transition_failed_cleanup_reopens_retryable_and_blocks_every_new_identity() {
    let directory = std::env::temp_dir().join(format!("pr0-transition-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(FaultyCredential {
        vault: Vault::default(),
        fail_write: false.into(),
        fail_delete: true.into(),
    });
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    sign_in(&service);
    service.library_create(save_request(&service)).unwrap();
    let old_generation = view(&service)["generation"].as_u64().unwrap();
    assert_eq!(
        service
            .transition(transition_request(&service, "discard", true))
            .err()
            .as_deref(),
        Some("credential_unavailable")
    );
    assert_eq!(view(&service)["state"], "cleanup_required");
    assert!(view(&service)["generation"].as_u64().unwrap() > old_generation);
    assert_eq!(
        service.begin("https://other.example").err().as_deref(),
        Some("sign_out_first")
    );
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    assert_eq!(view(&reopened)["state"], "cleanup_required");
    assert!(reopened.library_download().is_err());
    assert!(reopened.library_create(save_request(&reopened)).is_err());
    vault
        .fail_delete
        .store(false, std::sync::atomic::Ordering::SeqCst);
    reopened
        .transition(transition_request(&reopened, "retry_cleanup", false))
        .unwrap();
    assert_eq!(view(&reopened)["state"], "signed_out");
    sign_in(&reopened);
    assert_eq!(reopened.library_browse(0).unwrap().len(), 0);
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn transition_uncertain_failed_sync_keeps_pending_work_and_exact_text() {
    let directory = std::env::temp_dir().join(format!("pr0-transition-{}", uuid::Uuid::new_v4()));
    let transport = upload_fixture(false, false);
    transport
        .lose
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let vault = Arc::new(Vault::default());
    let service = downloaded_upload_service(&directory, transport.clone(), vault.clone());
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    assert_eq!(
        service
            .transition(transition_request(&service, "synchronize", false))
            .err()
            .as_deref(),
        Some("network_unavailable")
    );
    assert_eq!(view(&service)["state"], "signed_in");
    assert!(vault.read().unwrap().is_some());
    assert_eq!(
        service.library_detail(&request.prompt_id).unwrap().content,
        request.desired.content
    );
    assert_eq!(service.library_upload_status().unwrap().waiting, 1);
    drop(service);
    let reopened = AuthService::new(directory.clone(), transport, vault).unwrap();
    assert_eq!(reopened.library_upload_status().unwrap().waiting, 1);
    assert_eq!(
        reopened.library_detail(&request.prompt_id).unwrap().content,
        request.desired.content
    );
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn transition_missing_credentials_resume_only_the_same_instance_and_account() {
    let directory = std::env::temp_dir().join(format!("pr0-transition-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service =
        downloaded_upload_service(&directory, upload_fixture(false, false), vault.clone());
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    drop(service);
    vault.delete().unwrap();
    let transport = approval();
    transport.0.lock().unwrap()[3]["account"]["id"] = json!("55555555-5555-4555-8555-555555555555");
    let service = AuthService::new(directory.clone(), transport, vault.clone()).unwrap();
    assert_eq!(view(&service)["state"], "authentication_required");
    assert_eq!(
        service.begin("https://other.example").err().as_deref(),
        Some("same_account_required")
    );
    service.begin("https://instance.example").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1050));
    assert_eq!(
        service.poll().err().as_deref(),
        Some("same_account_required")
    );
    assert_eq!(
        service.library_detail(&request.prompt_id).unwrap().content,
        request.desired.content
    );
    assert_eq!(
        service.library_upload().err().as_deref(),
        Some("authentication_required")
    );
    drop(service);
    let transport = upload_fixture(false, false);
    let service = AuthService::new(directory.clone(), transport.clone(), vault).unwrap();
    sign_in(&service);
    assert_eq!(service.library_upload().unwrap().waiting, 0);
    assert_eq!(
        transport.traffic.lock().unwrap()[0].1["operations"][0]["desired"]["content"],
        request.desired.content
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn transition_discard_invalidates_delayed_upload_and_stale_commands_after_new_login() {
    let directory = std::env::temp_dir().join(format!("pr0-transition-{}", uuid::Uuid::new_v4()));
    let entered = Arc::new(std::sync::Barrier::new(2));
    let release = Arc::new(std::sync::Barrier::new(2));
    let transport = Arc::new(UploadFixture {
        traffic: Mutex::new(vec![]),
        lose: std::sync::atomic::AtomicBool::new(false),
        conflict: false,
        quota: false,
        failure: Mutex::new(None),
        entered: Some(entered.clone()),
        release: Some(release.clone()),
    });
    let service = Arc::new(downloaded_upload_service(
        &directory,
        transport,
        Arc::new(Vault::default()),
    ));
    let save = save_request(&service);
    service.library_create(save.clone()).unwrap();
    let stale = transition_request(&service, "discard", true);
    let worker = service.clone();
    let task = std::thread::spawn(move || worker.library_upload());
    entered.wait();
    let discarded = service.transition(transition_request(&service, "discard", true));
    // Always release the network boundary, including when the assertion would fail.
    release.wait();
    let late = task.join().unwrap();
    discarded.unwrap();
    sign_in(&service);
    assert_eq!(late.err().as_deref(), Some("operation_cancelled"));
    assert_eq!(
        service.transition(stale).err().as_deref(),
        Some("operation_cancelled")
    );
    assert_eq!(
        service.library_create(save).err().as_deref(),
        Some("operation_cancelled")
    );
    assert_eq!(service.library_browse(0).unwrap().len(), 0);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn transition_switches_to_same_email_on_another_instance_only_after_cleanup() {
    let directory = std::env::temp_dir().join(format!("pr0-transition-{}", uuid::Uuid::new_v4()));
    let transport = approval();
    let mut other = fixtures();
    other["capabilities"]["origin"] = json!("https://other.example");
    other["capabilities"]["instanceId"] = json!("22222222-2222-4222-8222-222222222222");
    other["session"]["instance"] =
        json!({"origin":"https://other.example","id":"22222222-2222-4222-8222-222222222222"});
    other["session"]["account"]["id"] = json!("55555555-5555-4555-8555-555555555555");
    other["code"]["verification_uri"] = json!("https://other.example/device");
    other["code"]["verification_uri_complete"] = json!(format!(
        "https://other.example/device?user_code={}",
        other["code"]["user_code"].as_str().unwrap()
    ));
    transport.0.lock().unwrap().extend([
        other["capabilities"].clone(),
        other["code"].clone(),
        other["token"].clone(),
        other["session"].clone(),
    ]);
    let service =
        AuthService::new(directory.clone(), transport, Arc::new(Vault::default())).unwrap();
    sign_in(&service);
    let old = save_request(&service);
    service.library_create(old.clone()).unwrap();
    let email = view(&service)["email"].clone();
    service
        .transition(transition_request(&service, "discard", true))
        .unwrap();
    service.begin("https://other.example").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1050));
    service.poll().unwrap();
    assert_eq!(view(&service)["email"], email);
    assert_eq!(
        view(&service)["instanceId"],
        "22222222-2222-4222-8222-222222222222"
    );
    assert_eq!(
        view(&service)["accountId"],
        "55555555-5555-4555-8555-555555555555"
    );
    assert_eq!(service.library_browse(0).unwrap().len(), 0);
    assert_eq!(service.library_upload_status().unwrap().waiting, 0);
    assert_eq!(
        service.library_create(old).err().as_deref(),
        Some("operation_cancelled")
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[cfg(windows)]
#[test]
fn transition_filesystem_cleanup_failure_is_retryable_after_restart() {
    use std::os::windows::fs::OpenOptionsExt;
    let directory = std::env::temp_dir().join(format!("pr0-transition-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), approval(), vault.clone()).unwrap();
    sign_in(&service);
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    let path =
        super::library_storage::library_path(&directory, &request.instance_id, &request.account_id)
            .unwrap();
    // Permit SQLite reads/writes but deny unlinking while a separate Windows handle is open.
    let held = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(&path)
        .unwrap();
    let cleanup = service.transition(transition_request(&service, "discard", true));
    drop(held);
    assert_eq!(cleanup.err().as_deref(), Some("storage_unavailable"));
    assert_eq!(view(&service)["state"], "cleanup_required");
    assert!(vault.read().unwrap().is_none());
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(view(&reopened)["state"], "cleanup_required");
    reopened
        .transition(transition_request(&reopened, "retry_cleanup", false))
        .unwrap();
    assert!(!path.exists());
    assert_eq!(view(&reopened)["state"], "signed_out");
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn acknowledged_work_allows_sign_out_without_waiting_for_a_redundant_download() {
    let directory = std::env::temp_dir().join(format!("pr0-transition-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let service =
        downloaded_upload_service(&directory, upload_fixture(false, false), vault.clone());
    service.library_create(save_request(&service)).unwrap();
    let uploaded = service.library_upload().unwrap();
    assert_eq!(uploaded.waiting, 0);
    assert_eq!(uploaded.awaiting_download, 1);
    service.sign_out().unwrap();
    assert_eq!(view(&service)["state"], "signed_out");
    assert!(vault.read().unwrap().is_none());
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(view(&reopened)["state"], "signed_out");
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}
