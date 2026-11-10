use super::auth_contract::LegalKind;

// Records system-browser launches so legal links are proven to leave only by kind.
struct LegalBrowser {
    fixture: Arc<Fixture>,
    opened: Mutex<Vec<String>>,
}
impl Transport for LegalBrowser {
    fn request(
        &self,
        origin: &str,
        endpoint: Endpoint,
        token: Option<&str>,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        self.fixture.request(origin, endpoint, token, body)
    }
    fn open_browser(&self, url: &str) -> Result<(), String> {
        self.opened.lock().unwrap().push(url.into());
        Ok(())
    }
}
fn legal_approval(legal: Option<serde_json::Value>) -> Arc<LegalBrowser> {
    let fixture = approval();
    if let Some(legal) = legal {
        fixture.0.lock().unwrap()[0]["legal"] = legal;
    }
    Arc::new(LegalBrowser {
        fixture,
        opened: Mutex::new(vec![]),
    })
}

#[test]
fn instance_legal_links_follow_the_selected_instance_through_sign_in_and_restart() {
    let directory = std::env::temp_dir().join(format!("pr0-legal-test-{}", uuid::Uuid::new_v4()));
    let vault = Arc::new(Vault::default());
    let legal = json!({
        "impressum": "https://operator.example/impressum",
        "terms": "https://operator.example/terms"
    });
    let transport = legal_approval(Some(legal.clone()));
    let service = AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap();
    assert_eq!(view(&service)["legal"], serde_json::Value::Null);
    assert_eq!(
        service.open_legal(LegalKind::Impressum).err().as_deref(),
        Some("legal_link_unavailable")
    );
    service.begin("https://instance.example").unwrap();
    assert_eq!(view(&service)["state"], "awaiting_approval");
    assert_eq!(view(&service)["legal"], legal);
    // An approval opens the device URL; only legal launches are asserted below.
    transport.opened.lock().unwrap().clear();
    service.open_legal(LegalKind::Terms).unwrap();
    assert_eq!(
        service.open_legal(LegalKind::Privacy).err().as_deref(),
        Some("legal_link_unavailable")
    );
    // The command argument is a kind, so a URL or unknown name never reaches the service.
    for kind in ["https://attacker.example", "cookies", "Terms"] {
        assert!(serde_json::from_value::<LegalKind>(json!(kind)).is_err(), "{kind}");
    }
    assert_eq!(
        *transport.opened.lock().unwrap(),
        vec!["https://operator.example/terms".to_string()]
    );
    std::thread::sleep(std::time::Duration::from_millis(1050));
    service.poll().unwrap();
    assert_eq!(view(&service)["state"], "signed_in");
    assert_eq!(view(&service)["legal"], legal);
    drop(service);
    let reopened = AuthService::new(directory.clone(), approval(), vault).unwrap();
    assert_eq!(view(&reopened)["legal"], legal);
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn unconfigured_instances_show_no_legal_links() {
    let directory = std::env::temp_dir().join(format!("pr0-legal-test-{}", uuid::Uuid::new_v4()));
    let transport = legal_approval(None);
    let service =
        AuthService::new(directory.clone(), transport.clone(), Arc::new(Vault::default())).unwrap();
    service.begin("https://instance.example").unwrap();
    assert_eq!(view(&service)["legal"], serde_json::Value::Null);
    transport.opened.lock().unwrap().clear();
    assert_eq!(
        service.open_legal(LegalKind::Impressum).err().as_deref(),
        Some("legal_link_unavailable")
    );
    assert!(transport.opened.lock().unwrap().is_empty());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn unsafe_instance_legal_links_reject_discovery() {
    for link in [
        "http://operator.example/privacy",
        "javascript:alert(1)",
        "file:///C:/Windows/System32/calc.exe",
        "https://user:secret@operator.example/privacy",
    ] {
        let directory =
            std::env::temp_dir().join(format!("pr0-legal-test-{}", uuid::Uuid::new_v4()));
        let transport = legal_approval(Some(json!({ "privacy": link })));
        let service =
            AuthService::new(directory.clone(), transport.clone(), Arc::new(Vault::default()))
                .unwrap();
        assert_eq!(
            service.begin("https://instance.example").err().as_deref(),
            Some("incompatible_instance"),
            "{link}"
        );
        assert!(transport.opened.lock().unwrap().is_empty());
        drop(service);
        let _ = std::fs::remove_dir_all(directory);
    }
    let directory = std::env::temp_dir().join(format!("pr0-legal-test-{}", uuid::Uuid::new_v4()));
    let transport = legal_approval(Some(json!({ "cookies": "https://operator.example/c" })));
    let service =
        AuthService::new(directory.clone(), transport, Arc::new(Vault::default())).unwrap();
    assert_eq!(
        service.begin("https://instance.example").err().as_deref(),
        Some("invalid_response")
    );
    drop(service);
    let _ = std::fs::remove_dir_all(directory);
}
