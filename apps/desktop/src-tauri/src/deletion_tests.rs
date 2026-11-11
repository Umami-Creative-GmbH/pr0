// Public native command seam, real SQLite, the instance's unsigned deletion status (ADR-0005).
fn deleted() -> serde_json::Value {
    json!({"status":"deleted", "accountId":fixtures()["session"]["account"]["id"], "deletedAt":"2026-11-11T10:00:00.000Z"})
}

#[test]
fn deletion_legacy_retained_receipt_and_anchor_still_load() {
    let mut trust = fixtures()["capabilities"].clone();
    trust["deletionKey"] = json!({"kid":"22222222-2222-4222-8222-222222222222","kty":"OKP","crv":"Ed25519","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"});
    let legacy = json!({
        "version": 1, "identity": fixtures()["session"], "trust": trust, "cleanupPending": true,
        "deletionProof": {"receipt":"a.b.c", "rotations":[]}
    });
    let retained: super::auth_contract::Retained = serde_json::from_value(legacy).unwrap();
    assert!(retained.deletion_confirmed());
    let written = serde_json::to_value(&retained).unwrap();
    assert!(written.get("deletionProof").is_none());
    assert!(written["trust"].get("deletionKey").is_none());
    let current: super::auth_contract::Retained = serde_json::from_value(json!({
        "version": 1, "identity": fixtures()["session"], "trust": fixtures()["capabilities"],
        "cleanupPending": false
    }))
    .unwrap();
    assert!(!current.deletion_confirmed());
}

#[test]
fn deletion_status_authorizes_cleanup_only_for_the_retained_account() {
    let retained: super::auth_contract::Retained = serde_json::from_value(json!({
        "version": 1, "identity": fixtures()["session"], "trust": fixtures()["capabilities"],
        "cleanupPending": false
    }))
    .unwrap();
    let parse = |value: serde_json::Value| {
        serde_json::from_value::<super::deletion_status::Lookup>(value)
            .map_err(|_| "invalid_response".to_owned())
            .and_then(|lookup| super::deletion_status::confirmed(lookup, &retained))
    };
    assert!(parse(deleted()).unwrap().is_some());
    assert!(parse(json!({"status":"absent"})).unwrap().is_none());
    let mut other = deleted();
    other["accountId"] = json!("99999999-9999-4999-8999-999999999999");
    let mut bad_time = deleted();
    bad_time["deletedAt"] = json!("2026-11-11 10:00");
    let mut receipt = deleted();
    receipt["receipt"] = json!("a.b.c");
    for invalid in [
        other,
        bad_time,
        receipt,
        json!({"status":"pending"}),
        json!({"status":"deleted"}),
    ] {
        assert!(parse(invalid).is_err());
    }
}
#[test]
fn deletion_completion_invalidates_in_flight_authority_and_never_resurrects_session() {
    struct DelayedAuthority {
        inner: Arc<DeletionTransport>,
        delay: std::sync::atomic::AtomicBool,
        entered: std::sync::Barrier,
        release: std::sync::Barrier,
    }
    impl Transport for DelayedAuthority {
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
            if matches!(endpoint, Endpoint::Session)
                && self.delay.load(std::sync::atomic::Ordering::SeqCst)
            {
                self.entered.wait();
                self.release.wait();
            }
            self.inner.request(origin, endpoint, token, body)
        }
    }
    let directory = std::env::temp_dir().join(format!("pr0-deletion-{}", uuid::Uuid::new_v4()));
    let transport = Arc::new(DelayedAuthority {
        inner: DeletionTransport::new(),
        delay: false.into(),
        entered: std::sync::Barrier::new(2),
        release: std::sync::Barrier::new(2),
    });
    let service = Arc::new(
        AuthService::new(
            directory.clone(),
            transport.clone(),
            Arc::new(Vault::default()),
        )
        .unwrap(),
    );
    sign_in(&service);
    transport
        .delay
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let pending = service.clone();
    let task = std::thread::spawn(move || pending.refresh());
    transport.entered.wait();
    *transport.inner.lookup.lock().unwrap() =
        Ok(deleted());
    service.refresh().unwrap();
    transport.release.wait();
    assert_eq!(
        task.join().unwrap().err().as_deref(),
        Some("operation_cancelled")
    );
    assert_eq!(view(&service)["state"], "signed_out");
    assert!(transport.inner.inner.traffic.lock().unwrap().is_empty());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
struct DeletionTransport {
    inner: Arc<UploadFixture>,
    lookup: Mutex<Result<serde_json::Value, String>>,
    session: Mutex<Option<serde_json::Value>>,
}
impl DeletionTransport {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: upload_fixture(false, false),
            lookup: Mutex::new(Ok(json!({"status":"absent"}))),
            session: Mutex::new(None),
        })
    }
}
impl Transport for DeletionTransport {
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
        match endpoint {
            Endpoint::DeletionLookup => {
                assert!(token.is_none());
                self.lookup.lock().unwrap().clone()
            }
            Endpoint::Session if self.session.lock().unwrap().is_some() => {
                Ok(self.session.lock().unwrap().clone().unwrap())
            }
            _ => self.inner.request(origin, endpoint, token, body),
        }
    }
}
fn deletion_pending(service: &AuthService) -> super::local_contract::SaveRequest {
    serde_json::from_value(json!({
        "instanceId": fixtures()["session"]["instance"]["id"], "accountId": fixtures()["session"]["account"]["id"],
        "generation": view(service)["generation"], "operationId": uuid::Uuid::new_v4(), "promptId": uuid::Uuid::new_v4(),
        "expectedLocalRevision": null, "desired": {"title":"Retain", "description":"", "content":"Complete offline work"}
    })).unwrap()
}

#[test]
fn deletion_status_without_credentials_clears_exact_partition_and_replays() {
    for _ in 0..2 {
        let directory = std::env::temp_dir().join(format!("pr0-deletion-{}", uuid::Uuid::new_v4()));
        let vault = Arc::new(Vault::default());
        let transport = DeletionTransport::new();
        let service =
            AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap();
        sign_in(&service);
        service.library_create(deletion_pending(&service)).unwrap();
        let other = directory.join("another-account.sqlite");
        std::fs::write(&other, "Other account retained work").unwrap();
        vault.delete().unwrap();
        drop(service);
        *transport.lookup.lock().unwrap() =
            Ok(deleted());
        let service = AuthService::new(directory.clone(), transport.clone(), vault).unwrap();
        assert_eq!(view(&service)["state"], "authentication_required");
        assert_eq!(
            serde_json::to_value(service.restore().unwrap()).unwrap()["state"],
            "signed_out"
        );
        assert_eq!(
            std::fs::read_to_string(other).unwrap(),
            "Other account retained work"
        );
        assert!(transport.inner.traffic.lock().unwrap().is_empty());
        drop(service);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[test]
fn deletion_untrusted_evidence_and_replacement_authority_preserve_work_and_stop_upload() {
    let directory = std::env::temp_dir().join(format!("pr0-deletion-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let transport = DeletionTransport::new();
    let service = AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    service.library_download().unwrap();
    let request = deletion_pending(&service);
    service.library_create(request.clone()).unwrap();
    let mut other_account = deleted();
    other_account["accountId"] = json!("99999999-9999-4999-8999-999999999999");
    let mut receipt = deleted();
    receipt["receipt"] = json!("a.b.c");
    let responses: Vec<Result<serde_json::Value, String>> = vec![
        Ok(other_account),
        Ok(receipt),
        Ok(json!({"status":"deleted"})),
        Ok(json!({"status":"pending"})),
        Err("authentication_required".into()),
        Err("network_unavailable".into()),
    ];
    for response in responses {
        *transport.lookup.lock().unwrap() = response;
        service.library_upload().unwrap();
        assert_eq!(
            service.library_detail(&request.prompt_id).unwrap().content,
            request.desired.content
        );
        assert_eq!(service.library_pending().unwrap().len(), 1);
        assert!(vault.read().unwrap().is_some());
        assert!(transport.inner.traffic.lock().unwrap().is_empty());
        assert!(service.refresh().is_err());
    }
    *transport.lookup.lock().unwrap() = Ok(json!({"status":"absent"}));
    for field in ["account", "instance"] {
        let mut replacement = fixtures()["session"].clone();
        replacement[field]["id"] = json!("99999999-9999-4999-8999-999999999999");
        *transport.session.lock().unwrap() = Some(replacement);
        assert!(service.refresh().is_err());
        assert_eq!(service.library_pending().unwrap().len(), 1);
    }
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn deletion_credential_failure_keeps_cleanup_retryable_after_restart() {
    let directory = std::env::temp_dir().join(format!("pr0-deletion-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(FaultyCredential {
        vault: Vault::default(),
        fail_write: false.into(),
        fail_delete: true.into(),
    });
    let transport = DeletionTransport::new();
    let service = AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap();
    sign_in(&service);
    service.library_create(deletion_pending(&service)).unwrap();
    *transport.lookup.lock().unwrap() =
        Ok(deleted());
    assert_eq!(
        service.refresh().err().as_deref(),
        Some("credential_unavailable")
    );
    assert_eq!(view(&service)["state"], "cleanup_required");
    drop(service);
    *transport.lookup.lock().unwrap() = Err("network_unavailable".into());
    let service = AuthService::new(directory.clone(), transport, vault.clone()).unwrap();
    assert!(service.library_browse(0).is_err());
    vault
        .fail_delete
        .store(false, std::sync::atomic::Ordering::SeqCst);
    service
        .transition(transition_request(&service, "retry_cleanup", false))
        .unwrap();
    assert!(vault.read().unwrap().is_none());
    assert_eq!(view(&service)["state"], "signed_out");
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn deletion_cleanup_failure_invalidates_copy_and_save_and_retries_offline_after_restart() {
    let directory = std::env::temp_dir().join(format!("pr0-deletion-{}", uuid::Uuid::new_v4()));
    let transport = DeletionTransport::new();
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap();
    sign_in(&service);
    let request = deletion_pending(&service);
    service.library_create(request.clone()).unwrap();
    // A directory in place of the exact WAL sidecar is a safe, reproducible cleanup failure.
    let path =
        super::library_storage::library_path(&directory, &request.instance_id, &request.account_id)
            .unwrap();
    let blocker = std::path::PathBuf::from(format!("{}-shm", path.display()));
    drop(service);
    std::fs::create_dir(&blocker).unwrap();
    let service = AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap();
    *transport.lookup.lock().unwrap() =
        Ok(deleted());
    assert!(service.refresh().is_err());
    assert_eq!(view(&service)["state"], "cleanup_required");
    assert!(service.library_create(request.clone()).is_err());
    assert!(service
        .copy_draft(
            &request.instance_id,
            &request.account_id,
            request.generation,
            "private value",
            |_| panic!("stale clipboard write")
        )
        .is_err());
    assert!(service.library_browse(0).is_err());
    drop(service);
    std::fs::remove_dir(&blocker).unwrap();
    *transport.lookup.lock().unwrap() = Err("network_unavailable".into());
    let service = AuthService::new(directory.clone(), transport, vault).unwrap();
    assert_eq!(view(&service)["state"], "cleanup_required");
    service
        .transition(transition_request(&service, "retry_cleanup", false))
        .unwrap();
    assert_eq!(view(&service)["state"], "signed_out");
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn deletion_reconnect_clears_only_confirmed_account_before_upload() {
    let directory = std::env::temp_dir().join(format!("pr0-deletion-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let transport = approval();
    let service = AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap();
    sign_in(&service);
    let request = serde_json::from_value(json!({
        "instanceId": fixtures()["session"]["instance"]["id"],
        "accountId": fixtures()["session"]["account"]["id"],
        "generation": view(&service)["generation"],
        "operationId": "77777777-7777-4777-8777-777777777777",
        "promptId": "88888888-8888-4888-8888-888888888888",
        "expectedLocalRevision": null,
        "desired": {"title":"Pending", "description":"", "content":"Deleted account pending work"}
    }))
    .unwrap();
    service.library_create(request).unwrap();
    *transport.0.lock().unwrap() = vec![deleted()];
    service.refresh().unwrap();
    assert_eq!(view(&service)["state"], "signed_out");
    assert!(vault.read().unwrap().is_none());
    assert!(service.library_browse(0).is_err());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
