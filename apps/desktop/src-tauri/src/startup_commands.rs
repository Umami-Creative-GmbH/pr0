#[tauri::command]
fn startup_status(window: tauri::WebviewWindow) -> Result<startup::StartupStatus, String> {
    authorize(&window)?;
    window.state::<startup::Startup>().status()
}

#[tauri::command]
fn startup_action(window: tauri::WebviewWindow, action: startup::StartupAction) -> Result<startup::StartupStatus, String> {
    authorize(&window)?;
    let result = window.state::<startup::Startup>().action(action);
    let _ = window.emit("startup-changed", ());
    result
}
#[tauri::command]
fn surface_visible(window: tauri::WebviewWindow) -> Result<bool, String> {
    authorize_labels(&window, &["main", "launcher"])?;
    Ok(window.is_visible().map_err(|_| "window_unavailable")?
        && !window.is_minimized().map_err(|_| "window_unavailable")?)
}
