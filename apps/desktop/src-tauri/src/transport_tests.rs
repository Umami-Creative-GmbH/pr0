// Real instance HTTPS against a local TLS server, with the trust source injected (ADR-0003).
// Fixtures: a private test CA, a leaf for localhost/127.0.0.1 and a leaf for another name.
const TEST_CA: &[u8] = include_bytes!("../fixtures/instance-tls/ca.pem");
const INSTANCE_CERTIFICATE: &[u8] = include_bytes!("../fixtures/instance-tls/instance.pem");
const OTHER_NAME_CERTIFICATE: &[u8] = include_bytes!("../fixtures/instance-tls/other-name.pem");
const INSTANCE_KEY: &[u8] = include_bytes!("../fixtures/instance-tls/instance.key");

struct TlsInstance {
    origin: String,
    requests: Arc<Mutex<Vec<String>>>,
}
fn tls_instance(certificate: &[u8], response: String) -> TlsInstance {
    use rustls::pki_types::pem::PemObject;
    use rustls::pki_types::{CertificateDer, PrivateKeyDer};
    use std::io::{Read, Write};
    let config = Arc::new(
        rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from_pem_slice(certificate).unwrap()],
            PrivateKeyDer::from_pem_slice(INSTANCE_KEY).unwrap(),
        )
        .unwrap(),
    );
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("https://localhost:{}", listener.local_addr().unwrap().port());
    let requests = Arc::new(Mutex::new(vec![]));
    let recorded = requests.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
            let connection = rustls::ServerConnection::new(config.clone()).unwrap();
            let mut tls = rustls::StreamOwned::new(connection, stream);
            let mut head = Vec::new();
            let mut byte = [0_u8; 1];
            // A rejected handshake ends here without any HTTP request reaching the server.
            while !head.ends_with(b"\r\n\r\n") && tls.read(&mut byte).is_ok_and(|n| n == 1) {
                head.push(byte[0]);
            }
            if !head.ends_with(b"\r\n\r\n") {
                continue;
            }
            let head = String::from_utf8_lossy(&head).into_owned();
            let length = head
                .lines()
                .find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                .unwrap_or(0);
            let mut body = vec![0_u8; length];
            let _ = tls.read_exact(&mut body);
            recorded.lock().unwrap().push(head.lines().next().unwrap_or_default().to_owned());
            let _ = tls.write_all(response.as_bytes());
            let _ = tls.flush();
            tls.conn.send_close_notify();
            let _ = tls.flush();
        }
    });
    TlsInstance { origin, requests }
}
fn json_response(body: &serde_json::Value) -> String {
    let body = body.to_string();
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}
fn trusting_test_ca() -> super::auth_transport::HttpsTransport {
    super::auth_transport::HttpsTransport::with_trust(
        super::auth_transport::InstanceTrust::with_pem_roots(TEST_CA).unwrap(),
    )
    .unwrap()
}
fn platform_only() -> super::auth_transport::HttpsTransport {
    super::auth_transport::HttpsTransport::with_trust(super::auth_transport::InstanceTrust::Platform)
        .unwrap()
}

#[test]
fn desktop_bundles_no_public_root_store_for_instance_https() {
    assert!(!include_str!("../Cargo.lock").contains("name = \"webpki-roots\""));
}

#[test]
fn instance_https_accepts_a_root_the_trust_source_supplies() {
    let capabilities = fixtures()["capabilities"].clone();
    let instance = tls_instance(INSTANCE_CERTIFICATE, json_response(&capabilities));
    let transport = trusting_test_ca();
    assert_eq!(
        transport.request(&instance.origin, Endpoint::Capabilities, None, None),
        Ok(capabilities.clone())
    );
    assert_eq!(
        transport.changes(&instance.origin, "token", json!({"cursor":"1"}), &|| false),
        Ok(capabilities)
    );
    assert_eq!(instance.requests.lock().unwrap().len(), 2);
}

#[test]
fn instance_https_fails_closed_on_a_certificate_windows_does_not_trust() {
    let instance = tls_instance(INSTANCE_CERTIFICATE, json_response(&fixtures()["capabilities"]));
    let transport = platform_only();
    assert_eq!(
        transport.request(&instance.origin, Endpoint::Capabilities, None, None),
        Err("certificate_untrusted".into())
    );
    assert_eq!(
        transport.request(&instance.origin, Endpoint::Mutations, Some("token"), Some(json!({}))),
        Err("certificate_untrusted".into())
    );
    assert_eq!(
        transport.changes(&instance.origin, "token", json!({"cursor":"1"}), &|| false),
        Err("certificate_untrusted".into())
    );
    assert!(instance.requests.lock().unwrap().is_empty());
}

#[test]
fn instance_https_binds_the_certificate_to_the_selected_origin() {
    let instance = tls_instance(OTHER_NAME_CERTIFICATE, json_response(&fixtures()["capabilities"]));
    let transport = trusting_test_ca();
    assert_eq!(
        transport.request(&instance.origin, Endpoint::Capabilities, None, None),
        Err("certificate_untrusted".into())
    );
    assert!(instance.requests.lock().unwrap().is_empty());
    let plain = instance.origin.replacen("https://", "http://", 1);
    assert!(transport.request(&plain, Endpoint::Capabilities, None, None).is_err());
    assert!(super::auth_transport::canonical_origin(&plain).is_err());
}

#[test]
fn instance_https_still_refuses_redirects_from_a_trusted_instance() {
    let instance = tls_instance(
        INSTANCE_CERTIFICATE,
        "HTTP/1.1 302 Found\r\nLocation: https://elsewhere.example/api/v1/capabilities\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
    );
    let transport = trusting_test_ca();
    assert_eq!(
        transport.request(&instance.origin, Endpoint::Capabilities, None, None),
        Err("redirect_rejected".into())
    );
    assert!(transport
        .changes(&instance.origin, "token", json!({"cursor":"1"}), &|| false)
        .is_err());
    assert_eq!(instance.requests.lock().unwrap().len(), 2);
}

struct UntrustedSync {
    inner: Arc<UploadFixture>,
    https: super::auth_transport::HttpsTransport,
    origin: String,
}
impl Transport for UntrustedSync {
    fn open_browser(&self, url: &str) -> Result<(), String> {
        self.inner.open_browser(url)
    }
    fn request(
        &self,
        origin: &str,
        endpoint: Endpoint,
        token: Option<&str>,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        if matches!(endpoint, Endpoint::Mutations | Endpoint::Receipts) {
            return self.https.request(&self.origin, endpoint, token, body);
        }
        self.inner.request(origin, endpoint, token, body)
    }
}

#[test]
fn untrusted_instance_certificate_keeps_pending_work_and_the_session() {
    let directory = std::env::temp_dir().join(format!("pr0-untrusted-{}", uuid::Uuid::new_v4()));
    let instance = tls_instance(INSTANCE_CERTIFICATE, json_response(&json!({"results":[]})));
    let transport = Arc::new(UntrustedSync {
        inner: upload_fixture(false, false),
        https: platform_only(),
        origin: instance.origin.clone(),
    });
    let vault = Arc::new(Vault::default());
    let service = AuthService::new(directory.clone(), transport.clone(), vault.clone()).unwrap();
    sign_in(&service);
    service.library_download().unwrap();
    service.library_download().unwrap();
    let request = save_request(&service);
    service.library_create(request.clone()).unwrap();
    let status = service.library_upload().unwrap();
    assert_eq!(status.error.as_deref(), Some("certificate_untrusted"));
    assert_eq!(status.waiting, 1);
    assert_eq!(view(&service)["state"], "signed_in");
    assert!(instance.requests.lock().unwrap().is_empty());
    drop(service);
    let service = AuthService::new(directory.clone(), transport, vault).unwrap();
    let status = service.library_upload_status().unwrap();
    assert_eq!(status.error.as_deref(), Some("certificate_untrusted"));
    assert_eq!(status.waiting, 1);
    assert_eq!(
        service.library_detail(&request.prompt_id).unwrap().content,
        request.desired.content
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
