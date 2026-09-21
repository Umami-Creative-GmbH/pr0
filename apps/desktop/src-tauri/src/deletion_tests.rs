// Public native command seam, real SQLite, signed cross-runtime fixtures.
fn deletion_vectors() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/deletion-proof-fixtures.json"
    ))
    .unwrap()
}

#[test]
fn deletion_continuity_pages_have_no_total_chain_size_lifetime() {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use ring::signature::Ed25519KeyPair;
    let seed = [
        0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c,
        0xc4, 0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae,
        0x7f, 0x60,
    ];
    let signing = Ed25519KeyPair::from_seed_unchecked(&seed).unwrap();
    let compact = |kid: &str, typ: &str, payload: serde_json::Value| {
        let input = format!(
            "{}.{}",
            URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(&json!({"alg":"Ed25519","typ":typ,"kid":kid})).unwrap()),
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap())
        );
        format!(
            "{input}.{}",
            URL_SAFE_NO_PAD.encode(signing.sign(input.as_bytes()).as_ref())
        )
    };
    let vectors = deletion_vectors();
    let mut previous = vectors["anchor"]["kid"].as_str().unwrap().to_owned();
    let mut rotations = vec![];
    for _ in 0..7000 {
        let next = uuid::Uuid::new_v4().to_string();
        let mut key = vectors["anchor"].clone();
        key["kid"] = json!(next);
        rotations.push(compact(&previous, "pr0-deletion-key-rotation+jws", json!({"version":1,"instanceId":vectors["claims"]["instanceId"],"oldKid":previous,"newKid":next,"key":key})));
        previous = next;
    }
    assert!(serde_json::to_vec(&rotations).unwrap().len() > 4_194_304);
    struct Pages {
        inner: Arc<UploadFixture>,
        rotations: Vec<String>,
        receipt: String,
        active: std::sync::atomic::AtomicBool,
    }
    impl Transport for Pages {
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
                    Ok(if self.active.load(std::sync::atomic::Ordering::SeqCst) {
                        json!({"status":"deleted", "receipt":self.receipt})
                    } else {
                        json!({"status":"absent"})
                    })
                }
                Endpoint::DeletionVerification => {
                    let page = body.ok_or("page_required")?["page"]
                        .as_u64()
                        .ok_or("page_required")? as usize;
                    let start = page * 64;
                    let end = (start + 64).min(self.rotations.len());
                    Ok(
                        json!({"instanceId":deletion_vectors()["claims"]["instanceId"], "anchor":deletion_vectors()["anchor"], "rotations":self.rotations[start..end], "nextPage":if end < self.rotations.len() {Some(page+1)} else {None}}),
                    )
                }
                _ => self.inner.request(origin, endpoint, token, body),
            }
        }
    }
    let transport = Arc::new(Pages {
        inner: upload_fixture(false, false),
        receipt: compact(
            &previous,
            "pr0-account-deletion+jws",
            vectors["claims"].clone(),
        ),
        rotations,
        active: false.into(),
    });
    let directory = std::env::temp_dir().join(format!("pr0-deletion-{}", uuid::Uuid::new_v4()));
    let service = AuthService::new(
        directory.clone(),
        transport.clone(),
        Arc::new(Vault::default()),
    )
    .unwrap();
    sign_in(&service);
    transport
        .active
        .store(true, std::sync::atomic::Ordering::SeqCst);
    service.refresh().unwrap();
    assert_eq!(view(&service)["state"], "signed_out");
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
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
        Ok(json!({"status":"deleted", "receipt":deletion_vectors()["receipt"]}));
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
    verification: Mutex<serde_json::Value>,
    session: Mutex<Option<serde_json::Value>>,
}
impl DeletionTransport {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: upload_fixture(false, false),
            lookup: Mutex::new(Ok(json!({"status":"absent"}))),
            verification: Mutex::new(deletion_vectors()["verification"].clone()),
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
            Endpoint::DeletionVerification => {
                assert!(token.is_none());
                Ok(self.verification.lock().unwrap().clone())
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
fn deletion_rotated_proof_without_credentials_clears_exact_partition_and_replays() {
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
            Ok(json!({"status":"deleted", "receipt":deletion_vectors()["rotatedReceipt"]}));
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
    let vectors = deletion_vectors();
    transport.verification.lock().unwrap()["rotations"] = json!([]);
    let mut responses: Vec<_> = vectors["invalidReceipts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|receipt| Ok(json!({"status":"deleted","receipt":receipt})))
        .collect();
    responses.extend([
        Ok(json!({"status":"deleted","receipt":"malformed"})),
        Ok(json!({"status":"pending"})),
        Err("authentication_required".into()),
        Err("network_unavailable".into()),
    ]);
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
    *transport.lookup.lock().unwrap() =
        Ok(json!({"status":"deleted", "receipt": vectors["rotatedReceipt"]}));
    let mut invalid_chain = vectors["verification"].clone();
    invalid_chain["rotations"] = json!([
        vectors["verification"]["rotations"][0],
        vectors["verification"]["rotations"][0]
    ]);
    *transport.verification.lock().unwrap() = invalid_chain;
    assert!(service.refresh().is_err());
    let mut wrong_anchor = vectors["verification"].clone();
    wrong_anchor["anchor"]["x"] = json!("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    *transport.verification.lock().unwrap() = wrong_anchor;
    assert!(service.refresh().is_err());
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
        Ok(json!({"status":"deleted", "receipt":deletion_vectors()["receipt"]}));
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
        Ok(json!({"status":"deleted", "receipt":deletion_vectors()["rotatedReceipt"]}));
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
fn deletion_reconnect_clears_only_proven_account_before_upload() {
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
    let evidence: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/api-contract/src/deletion-proof-fixtures.json"
    ))
    .unwrap();
    *transport.0.lock().unwrap() = vec![json!({"status":"deleted", "receipt":evidence["receipt"]})];
    service.refresh().unwrap();
    assert_eq!(view(&service)["state"], "signed_out");
    assert!(vault.read().unwrap().is_none());
    assert!(service.library_browse(0).is_err());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
