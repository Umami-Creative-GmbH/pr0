#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeCopy {
    native_open_library: String,
    native_open_launcher: String,
    native_settings: String,
    native_quit: String,
    native_tooltip: String,
    native_launcher_title: String,
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
    if let Some(tray) = app.tray_by_id("resident") {
        tray.set_tooltip(Some(&copy.native_tooltip))
            .map_err(|_| "native_language_unavailable")?;
    }
    if let Some(launcher) = app.get_webview_window("launcher") {
        launcher.set_title(&copy.native_launcher_title)
            .map_err(|_| "native_language_unavailable")?;
    }
    Ok(())
}
