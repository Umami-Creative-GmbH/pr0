#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeCopy {
    native_open_library: String,
    native_open_launcher: String,
    native_settings: String,
    native_quit: String,
    native_tooltip: String,
    native_launcher_title: String,
    native_shortcut_tooltip: String,
    native_shortcut_unavailable: String,
}

fn native_copy(language: &str) -> Result<NativeCopy, String> {
    let resource = match language {
        "en" => include_str!("../../../../packages/ui/src/locales/en.json"),
        "de" => include_str!("../../../../packages/ui/src/locales/de.json"),
        _ => return Err("unsupported_language".into()),
    };
    serde_json::from_str(resource).map_err(|_| "invalid_locale_resource".into())
}

struct NativeMenuCopy([tauri::menu::MenuItem<tauri::Wry>; 4]);
struct NativeLanguageCopy(std::sync::Mutex<NativeCopy>);

fn update_native_tooltip(app: &tauri::AppHandle) -> Result<(), String> {
    let language = app.state::<NativeLanguageCopy>();
    let copy = language.0.lock().map_err(|_| "native_language_unavailable")?;
    let status = app.state::<launcher_runtime::Launcher>().status()?;
    let shortcut = status.shortcut.as_deref().unwrap_or(&copy.native_shortcut_unavailable);
    if let Some(tray) = app.tray_by_id("resident") {
        tray.set_tooltip(Some(copy.native_shortcut_tooltip.replace("{0}", shortcut)))
            .map_err(|_| "native_language_unavailable")?;
    }
    Ok(())
}

#[tauri::command]
fn desktop_language(window: tauri::WebviewWindow, language: String) -> Result<(), String> {
    authorize(&window)?;
    let app = window.app_handle();
    let copy = native_copy(&language)?;
    let menu = app.state::<NativeMenuCopy>();
    for (item, label) in menu.0.iter().zip([
        &copy.native_open_library,
        &copy.native_open_launcher,
        &copy.native_settings,
        &copy.native_quit,
    ]) {
        item.set_text(label).map_err(|_| "native_language_unavailable")?;
    }
    if let Some(launcher) = app.get_webview_window("launcher") {
        launcher.set_title(&copy.native_launcher_title)
            .map_err(|_| "native_language_unavailable")?;
    }
    *app.state::<NativeLanguageCopy>().0.lock().map_err(|_| "native_language_unavailable")? = copy;
    update_native_tooltip(app)
}
