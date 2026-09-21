use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherStatus {
    #[serde(flatten)]
    window: launcher_runtime::WindowStatus,
    account: Option<LauncherAccount>,
    complete: bool,
    sync_status: &'static str,
    error: Option<&'static str>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherAccount {
    instance_id: String,
    account_id: String,
    generation: u64,
}

fn register_launcher_shortcut(app: &tauri::AppHandle) -> Result<(), String> {
    app.state::<launcher_runtime::Launcher>()
        .register(|candidate| {
            app.global_shortcut()
                .on_shortcut(candidate, |app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = open_launcher(app);
                    }
                })
                .is_ok()
        })?;
    let _ = app.emit("launcher-changed", ());
    Ok(())
}

fn open_launcher(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("launcher")
        .ok_or("launcher_unavailable")?;
    let opening = app.state::<launcher_runtime::Launcher>().open()?;
    if window.unminimize().and_then(|_| window.show()).is_err() {
        app.state::<launcher_runtime::Launcher>().hide(opening)?;
        return Err("launcher_unavailable".into());
    }
    let _ = app.emit("launcher-changed", ());
    let _ = window.set_focus();
    if window.is_focused().unwrap_or(false) {
        app.state::<launcher_runtime::Launcher>()
            .observe_focus(true)?;
        let _ = app.emit("launcher-changed", ());
    }
    Ok(())
}
fn hide_launcher(app: &tauri::AppHandle, opening: u64) -> Result<(), String> {
    if app.state::<launcher_runtime::Launcher>().hide(opening)? {
        app.get_webview_window("launcher")
            .ok_or("launcher_unavailable")?
            .hide()
            .map_err(|_| "launcher_unavailable")?;
        let _ = app.emit("launcher-changed", ());
    }
    Ok(())
}
fn launcher_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    // Preserve the existing main-window shutdown behavior until the separate
    // tray/safe-quit slice owns residency. A hidden launcher must not strand
    // a shortcut-owning process after its library window is destroyed.
    if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
        window.app_handle().exit(0);
        return;
    }
    if window.label() != "launcher" {
        return;
    }
    let Some(state) = window.try_state::<launcher_runtime::Launcher>() else {
        return;
    };
    match event {
        tauri::WindowEvent::Focused(focused) => {
            if state.observe_focus(*focused).unwrap_or(false) {
                let _ = window.hide();
            }
            let _ = window.app_handle().emit("launcher-changed", ());
        }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if let Ok(status) = state.status() {
                let _ = hide_launcher(window.app_handle(), status.opening);
            }
        }
        _ => {}
    }
}
#[tauri::command]
async fn launcher_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<LauncherStatus, String> {
    authorize_labels(&window, &["main", "launcher"])?;
    let view = window.state::<launcher_runtime::Launcher>().status()?;
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match service.and_then(|s| s.launcher_account()) {
        Ok((account, complete, sync_status)) => Ok(LauncherStatus {
            window: view,
            account,
            complete,
            sync_status,
            error: None,
        }),
        Err(_) => Ok(LauncherStatus {
            window: view,
            account: None,
            complete: false,
            sync_status: "Library status unavailable",
            error: Some("library_unavailable"),
        }),
    })
    .await
    .map_err(|_| "native_unavailable")?
}
#[tauri::command]
fn launcher_library_details(window: tauri::WebviewWindow) -> Result<(),String> {
    authorize_labels(&window,&["launcher"])?;
    let main=window.app_handle().get_webview_window("main").ok_or("library_unavailable")?;
    main.unminimize().and_then(|_|main.show()).and_then(|_|main.set_focus()).map_err(|_|"library_unavailable")?;
    main.emit("show-sync-details",()).map_err(|_|"library_unavailable".into())
}
#[tauri::command]
fn launcher_open(window: tauri::WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    open_launcher(window.app_handle())
}
#[tauri::command]
fn launcher_hide(window: tauri::WebviewWindow, opening: u64) -> Result<(), String> {
    authorize_labels(&window, &["launcher"])?;
    hide_launcher(window.app_handle(), opening)
}
#[tauri::command]
fn launcher_focus(window: tauri::WebviewWindow) -> Result<(), String> {
    authorize_labels(&window, &["launcher"])?;
    window
        .set_focus()
        .map_err(|_| "launcher_unavailable".into())
}
#[tauri::command]
fn launcher_retry_shortcut(window: tauri::WebviewWindow) -> Result<(), String> {
    authorize(&window)?;
    register_launcher_shortcut(window.app_handle())
}
#[tauri::command]
async fn launcher_search(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    request: search_contract::SearchRequest,
) -> Result<search_contract::SearchPage, String> {
    authorize_labels(&window, &["launcher"])?;
    let service = state.inner().clone()?;
    request.validate()?;
    let cancelled = service.admit_launcher_search(&request.request_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        service.launcher_search_admitted(request, cancelled)
    })
    .await
    .map_err(|_| "native_unavailable")?
}
#[tauri::command]
fn launcher_cancel_search(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    id: String,
) -> Result<(), String> {
    authorize_labels(&window, &["launcher"])?;
    state
        .inner()
        .as_ref()
        .map_err(Clone::clone)?
        .cancel_launcher_search(&id)
}
#[tauri::command]
async fn launcher_copy(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    request: usage_contract::CopyRequest,
    opening: u64,
) -> Result<usage_contract::CopyResult, String> {
    authorize_labels(&window, &["launcher"])?;
    window
        .state::<launcher_runtime::Launcher>()
        .require_opening(opening)?;
    let admission = clipboard::admit()?;
    let service = state.inner().clone()?;
    let app = window.app_handle().clone();
    let owner = app.clone();
    let authority = service.clone();
    app.state::<launcher_runtime::Launcher>().begin_write(opening)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _admission = admission;
        service.launcher_copy(request, |text| {
            owner
                .state::<launcher_runtime::Launcher>()
                .require_opening(opening)?;
            clipboard::write(text)
        })
    })
    .await;
    app.state::<launcher_runtime::Launcher>().end_write(opening)?;
    let result = result.map_err(|_| "native_unavailable")??;
    // Clipboard success stays success even if hiding fails. Usage retry never copies again.
    let same_partition = authority.launcher_account().ok().and_then(|(account, _)| account)
        .is_some_and(|account| account.instance_id == result.origin.instance_id
            && account.account_id == result.origin.account_id && account.generation == result.origin.generation);
    if same_partition { let _ = hide_launcher(&app, opening); }
    let _ = app.emit("library-changed", ());
    Ok(result)
}
