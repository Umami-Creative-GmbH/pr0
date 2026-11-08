use tauri_plugin_updater::UpdaterExt;

fn update_source(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let endpoint = option_env!("PR0_UPDATE_ENDPOINT").ok_or("update_unconfigured")?;
    let public_key = option_env!("PR0_UPDATE_PUBLIC_KEY")
        .filter(|value| !value.is_empty())
        .ok_or("update_unconfigured")?;
    let endpoint = url::Url::parse(endpoint).map_err(|_| "update_unconfigured")?;
    if endpoint.scheme() != "https"
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
    {
        return Err("update_unconfigured".into());
    }
    app.updater_builder()
        .pubkey(public_key)
        .endpoints(vec![endpoint])
        .map_err(|_| "update_unconfigured")?
        .timeout(std::time::Duration::from_secs(120))
        // The plugin's default hook destroys windows before ShellExecute can fail.
        // Keep the resident intact on failure; Windows releases its native handles
        // when the successful installer handoff exits the process.
        .on_before_exit(|| {})
        .build()
        .map_err(|_| "update_unconfigured".into())
}

#[tauri::command]
fn update_status(window: tauri::WebviewWindow) -> Result<updates::UpdateStatus, String> {
    authorize(&window)?;
    window.state::<updates::Updates>().status()
}

async fn check_application_update(app: &tauri::AppHandle) -> Result<(), String> {
    let source = update_source(app)?;
    let result = app.state::<updates::Updates>().check(source).await;
    let _ = app.emit("update-changed", ());
    result
}

#[tauri::command]
async fn update_check(window: tauri::WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    check_application_update(window.app_handle()).await
}

#[tauri::command]
async fn update_download(window: tauri::WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    let result = window.state::<updates::Updates>().download().await;
    let _ = window.emit("update-changed", ());
    result
}

#[tauri::command]
fn update_request_install(window: tauri::WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    window
        .state::<updates::Updates>()
        .request_install(&window.state::<Resident>())?;
    let _ = window.emit("resident-changed", ());
    Ok(())
}
