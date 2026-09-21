// Opt-in test process: actual production assets, WebView2, IPC authorization and
// native commands. Only account approval is a fixture; no test code ships in the app.
#[test]
fn desktop_search_webview_worker() {
    let Ok(directory) = std::env::var("PR0_SEARCH_WEBVIEW_DIRECTORY") else {
        return;
    };
    let directory = std::path::PathBuf::from(directory);
    let service: crate::ManagedAuth = Ok(Arc::new(
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap(),
    ));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .any_thread()
        .manage(service)
        .invoke_handler(tauri::generate_handler![
            crate::auth_status,
            crate::auth_begin,
            crate::auth_poll,
            crate::auth_cancel,
            crate::auth_open_browser,
            crate::auth_refresh,
            crate::auth_sign_out,
            crate::library_status,
            crate::library_download,
            crate::library_pause_download,
            crate::library_recovery_browse,
            crate::library_recovery_detail,
            crate::library_upload,
            crate::library_upload_status,
            crate::library_change_status,
            crate::library_sync,
            crate::library_browse,
            crate::library_search,
            crate::library_cancel_search,
            crate::library_recover_search,
            crate::library_detail,
            crate::library_editor,
            crate::library_create,
            crate::library_edit,
            crate::library_copy_draft,
            crate::library_copy,
            crate::library_recents,
            crate::library_usage_status,
            crate::library_retry_usage
        ])
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("pr0 — Offline search validation")
            .inner_size(1100.0, 900.0)
            .data_directory(directory.join("webview"))
            .build()?;
            Ok(())
        })
        .run(context)
        .expect("search validation WebView");
}
