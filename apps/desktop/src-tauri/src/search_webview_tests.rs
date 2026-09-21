// Opt-in test process: actual production assets, WebView2, IPC authorization and
// native commands. Only account approval is a fixture; no test code ships in the app.
#[test]
fn desktop_search_webview_worker() {
    use tauri::Manager;
    let Ok(directory) = std::env::var("PR0_SEARCH_WEBVIEW_DIRECTORY") else {
        return;
    };
    let directory = std::path::PathBuf::from(directory);
    let Some(instance) = crate::resident_instance::Instance::acquire(&directory).unwrap() else { return; };
    let instance = Arc::new(instance);
    let service: crate::ManagedAuth = Ok(Arc::new(
        AuthService::new(directory.clone(), approval(), Arc::new(Vault::default())).unwrap(),
    ));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .any_thread()
        .manage(service)
        .manage(crate::launcher_runtime::Launcher::default())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            crate::resident_status,
            crate::resident_action,
            crate::resident_hide,
            crate::resident_finish_quit,
            crate::launcher_status,
            crate::launcher_open,
            crate::launcher_hide,
            crate::launcher_focus,
            crate::launcher_retry_shortcut,
            crate::launcher_search,
            crate::launcher_cancel_search,
            crate::launcher_copy,
            crate::auth_status,
            crate::auth_begin,
            crate::auth_poll,
            crate::auth_cancel,
            crate::auth_open_browser,
            crate::auth_refresh,
            crate::auth_sign_out,
            crate::library_status,
            crate::library_organization,
            crate::library_organize,
            crate::library_organization_browse,
            crate::library_organization_impact,
            crate::library_organization_review,
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
            crate::setup_resident(app.handle(), directory.clone())?;
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("pr0 — Offline search validation")
            .inner_size(1100.0, 900.0)
            .data_directory(directory.join("webview"))
            .build()?;
            tauri::WebviewWindowBuilder::new(app, "launcher", tauri::WebviewUrl::App("launcher.html".into()))
                .title("pr0 Quick launcher")
                .inner_size(660.0, 580.0)
                .visible(false)
                .focused(false)
                .data_directory(directory.join("webview"))
                .build()?;
            crate::register_launcher_shortcut(app.handle())?;
            instance.listen(app.handle().clone());
            if std::env::var("PR0_TEST_CLOSE_MAIN").as_deref() == Ok("true") {
                let app = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    app.get_webview_window("main").unwrap().close().unwrap();
                });
            }
            Ok(())
        })
        .on_window_event(crate::resident_window_event)
        .run(context)
        .expect("search validation WebView");
}
