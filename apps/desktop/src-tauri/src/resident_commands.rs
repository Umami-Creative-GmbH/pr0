use resident::{Resident, ResidentAction, ResidentStatus};

fn show_library(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("library_unavailable")?;
    window
        .unminimize()
        .and_then(|_| window.show())
        .map_err(|_| "library_unavailable")?;
    // One request per explicit activation. Windows switching and the tray remain
    // available when Windows refuses foreground permission.
    let _ = window.set_focus();
    let _ = window.emit("surface-visibility", ());
    Ok(())
}

fn resident_action_impl(app: &tauri::AppHandle, action: ResidentAction) -> Result<(), String> {
    app.state::<Resident>().action(action)?;
    let _ = app.emit("resident-changed", ());
    show_library(app)
}

#[tauri::command]
fn resident_status(window: tauri::WebviewWindow) -> Result<ResidentStatus, String> {
    authorize(&window)?;
    window.state::<Resident>().status()
}

#[tauri::command]
fn resident_action(window: tauri::WebviewWindow, action: ResidentAction) -> Result<(), String> {
    authorize(&window)?;
    resident_action_impl(window.app_handle(), action)
}

struct ResidencyNotice(std::path::PathBuf);

#[tauri::command]
fn resident_hide(window: tauri::WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    let state = window.state::<Resident>();
    if state.status()?.quit_requested {
        return Err("quit_in_progress".into());
    }
    let marker = window.state::<ResidencyNotice>();
    let file = std::fs::File::create(&marker.0).map_err(|_| "storage_unavailable")?;
    file.sync_all().map_err(|_| "storage_unavailable")?;
    window.hide().map_err(|_| "library_unavailable")?;
    let _ = window.emit("surface-visibility", ());
    state.action(ResidentAction::CancelClose)?;
    let _ = window.emit("resident-changed", ());
    Ok(())
}

#[tauri::command]
fn resident_finish_quit(window: tauri::WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    let app = window.app_handle();
    app.state::<Resident>().finish_quit()?;
    if app.state::<Resident>().status()?.update_requested {
        let result = app.state::<updates::Updates>().install();
        app.state::<Resident>().cancel_failed_update()?;
        let _ = app.emit("resident-changed", ());
        let _ = app.emit("update-changed", ());
        return result;
    }
    // Local saves are resolved; pending uploads remain durable. Do not join a
    // network worker here. Process exit terminates it without waiting online.
    let _ = app.global_shortcut().unregister_all();
    app.remove_tray_by_id("resident");
    app.exit(0);
    Ok(())
}

fn resident_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    launcher_window_event(window, event);
    if matches!(event, tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_)) {
        let _ = window.emit("surface-visibility", ());
    }
    if window.label() != "main" {
        return;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let app = window.app_handle();
        let Some(state) = app.try_state::<Resident>() else {
            return;
        };
        if state.status().is_ok_and(|s| s.quit_requested) {
            let _ = show_library(app);
        } else if app
            .try_state::<ResidencyNotice>()
            .is_some_and(|marker| marker.0.exists())
        {
            let _ = window.hide();
            let _ = window.emit("surface-visibility", ());
        } else {
            let _ = resident_action_impl(app, ResidentAction::Close);
        }
    }
}

fn setup_resident(app: &tauri::AppHandle, directory: std::path::PathBuf) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    std::fs::create_dir_all(&directory)?;
    app.manage(Resident::default());
    app.manage(ResidencyNotice(directory.join("residency-explained")));
    let library = MenuItem::with_id(app, "resident-library", "Open &library", true, None::<&str>)?;
    let launcher = MenuItem::with_id(
        app,
        "resident-launcher",
        "Open quic&k launcher",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "resident-settings", "&Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "resident-quit", "&Quit pr0", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&library, &launcher, &settings, &quit])?;
    TrayIconBuilder::with_id("resident")
        .icon(
            app.default_window_icon()
                .expect("bundled application icon")
                .clone(),
        )
        .tooltip("pr0 — Open library")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let result = match event.id.as_ref() {
                "resident-library" => show_library(app),
                "resident-launcher" => open_launcher(app),
                "resident-settings" => resident_action_impl(app, ResidentAction::Settings),
                "resident-quit" => resident_action_impl(app, ResidentAction::Quit),
                _ => Ok(()),
            };
            if result.is_err() {
                let _ = show_library(app);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = show_library(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
