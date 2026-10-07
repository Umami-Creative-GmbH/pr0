use crate::resident::{Resident, ResidentAction};
use crate::updates::Updates;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::io::{Read, Write};
use tauri_plugin_updater::UpdaterExt;

fn signed_download(
    tampered: bool,
    announced: &str,
) -> (
    tauri::App<tauri::test::MockRuntime>,
    tauri_plugin_updater::Updater,
    std::thread::JoinHandle<()>,
) {
    let pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
    let signature = minisign::sign(
        Some(&pair.pk),
        &pair.sk,
        &b"signed installer fixture"[..],
        Some("version:0.2.0"),
        None,
    )
    .unwrap();
    let public = STANDARD.encode(pair.pk.to_box().unwrap().to_string());
    let signature = STANDARD.encode(signature.to_string());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let manifest = serde_json::json!({ "version": announced, "url": format!("{origin}/installer.exe"), "signature": signature }).to_string();
    let server = std::thread::spawn(move || {
        for bytes in [
            manifest.into_bytes(),
            if tampered {
                b"tampered installer".to_vec()
            } else {
                b"signed installer fixture".to_vec()
            },
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut buffer = [0; 4096];
            let _ = stream.read(&mut buffer).unwrap();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            )
            .unwrap();
            stream.write_all(&bytes).unwrap();
        }
    });
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert("updater".into(), serde_json::json!({ "pubkey": public, "dangerousInsecureTransportProtocol": true, "requireSignedVersion": true }));
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let updater = app
        .updater_builder()
        .endpoints(vec![url::Url::parse(&origin).unwrap()])
        .unwrap()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();
    (app, updater, server)
}

#[test]
fn updater_verifies_artifact_and_version_before_offering_installation() {
    for (tampered, announced, expected) in [
        (false, "0.2.0", "ready"),
        (true, "0.2.0", "available"),
        (false, "9.0.0", "available"),
    ] {
        let (_app, updater, server) = signed_download(tampered, announced);
        let directory = std::env::temp_dir().join(format!("pr0-update-{}", uuid::Uuid::new_v4()));
        let updates = Updates::new(directory, true, "0.1.0");
        let resident = Resident::default();
        assert_eq!(
            updates.request_install(&resident),
            Err("update_not_verified".into())
        );
        tauri::async_runtime::block_on(async {
            updates.check(updater).await.unwrap();
            assert_eq!(updates.status().unwrap().phase, "available");
            updates.download().await.unwrap();
        });
        let status = updates.status().unwrap();
        assert_eq!(status.phase, expected);
        if expected == "ready" {
            updates.request_install(&resident).unwrap();
            assert!(resident.status().unwrap().update_requested);
        } else {
            assert_eq!(status.error, Some("verification_failed"));
            assert_eq!(
                updates.request_install(&resident),
                Err("update_not_verified".into())
            );
            assert!(!resident.status().unwrap().quit_requested);
        }
        server.join().unwrap();
    }
}

#[test]
fn update_quit_preserves_save_admission_and_cancel_restores_normal_quit() {
    let resident = Resident::default();
    resident.begin_save().unwrap();
    resident.request_update().unwrap();
    assert!(resident.status().unwrap().update_requested);
    assert_eq!(resident.finish_quit(), Err("save_in_progress".into()));
    resident.end_save();
    resident.action(ResidentAction::CancelQuit).unwrap();
    assert!(!resident.status().unwrap().update_requested);
    assert_eq!(resident.finish_quit(), Err("quit_not_requested".into()));
    resident.action(ResidentAction::Quit).unwrap();
    assert!(!resident.status().unwrap().update_requested);
}

#[test]
fn installer_launch_failure_allows_the_user_to_keep_working_and_retry() {
    let resident = Resident::default();
    resident.request_update().unwrap();
    resident.finish_quit().unwrap();
    assert_eq!(resident.begin_save(), Err("quitting".into()));
    resident.cancel_failed_update().unwrap();
    assert!(!resident.status().unwrap().quitting);
    assert!(!resident.status().unwrap().quit_requested);
    resident.begin_save().unwrap();
    resident.end_save();
    resident.request_update().unwrap();
    assert!(resident.finish_quit().is_ok());
}

#[test]
fn failed_install_is_still_actionable_after_restart_and_automatic_check() {
    let directory =
        std::env::temp_dir().join(format!("pr0-update-recovery-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let (_app, updater, server) = signed_download(false, "0.2.0");
    let updates = Updates::new(directory.clone(), true, "0.1.0");
    tauri::async_runtime::block_on(async {
        updates.check(updater).await.unwrap();
        updates.download().await.unwrap();
    });
    // Signed fixture data is deliberately not an executable: exercise the real
    // installer's format rejection without launching any child installer.
    assert_eq!(updates.install(), Err("install_failed".into()));
    server.join().unwrap();
    let reopened = Updates::new(directory.clone(), true, "0.1.0");
    assert_eq!(reopened.status().unwrap().error, Some("install_failed"));
    let (_app, updater, server) = signed_download(false, "0.2.0");
    tauri::async_runtime::block_on(async {
        reopened.check(updater).await.unwrap();
        assert_eq!(reopened.status().unwrap().error, Some("install_failed"));
        reopened.download().await.unwrap();
    });
    server.join().unwrap();
    let upgraded = Updates::new(directory.clone(), true, "0.2.0");
    assert_eq!(upgraded.status().unwrap().error, None);
    std::fs::remove_dir_all(directory).unwrap();
}
