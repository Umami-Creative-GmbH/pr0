// PROTOTYPE (issue #9) — native quick launcher.
//
// Exists to answer the Windows-specific questions on issue #9 that a browser
// cannot answer: global shortcut registration, collision fallback, foreground
// focus, and close-on-success. Throwaway; no persistence.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

const LAUNCHER_LABEL: &str = "launcher";
const MAIN_LABEL: &str = "main";

/// Which shortcut actually registered, so the UI can report the fallback.
struct RegisteredShortcut(Mutex<Option<String>>);

/// Preference order. Registration fails when another application already owns
/// the combination, so the prototype walks the list and reports what it got.
fn shortcut_candidates() -> Vec<(&'static str, Shortcut)> {
    vec![
        (
            "Ctrl+Shift+P",
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyP),
        ),
        (
            "Alt+Space",
            Shortcut::new(Some(Modifiers::ALT), Code::Space),
        ),
        (
            "Ctrl+Alt+P",
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP),
        ),
        (
            "Ctrl+Shift+Space",
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space),
        ),
    ]
}

/// Shows the launcher and pulls it to the foreground.
///
/// OPEN QUESTION for issue #9: on Windows, `set_focus` only reliably steals
/// the foreground when the calling process already owns it. If the launcher
/// appears without keyboard focus while another app is active, that is the
/// documented Windows foreground restriction and needs an explicit fallback
/// decision (flash the taskbar, or attach to the foreground thread).
fn show_launcher(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LAUNCHER_LABEL) else {
        return;
    };

    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    // The launcher resets its query and filters on every opening.
    let _ = window.emit("launcher:opened", ());
}

fn hide_launcher_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LAUNCHER_LABEL) {
        let _ = window.hide();
    }
}

#[tauri::command]
fn registered_shortcut(state: tauri::State<'_, RegisteredShortcut>) -> Option<String> {
    state.0.lock().ok().and_then(|value| value.clone())
}

#[tauri::command]
fn open_launcher(app: AppHandle) {
    show_launcher(&app);
}

#[tauri::command]
fn hide_launcher(app: AppHandle) {
    hide_launcher_window(&app);
}

/// Relays a message from one window to the other. The main window owns the
/// library; the launcher window mirrors it.
#[tauri::command]
fn relay(app: AppHandle, event: String, payload: serde_json::Value) {
    for label in [MAIN_LABEL, LAUNCHER_LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.emit(&event, payload.clone());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        show_launcher(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            registered_shortcut,
            open_launcher,
            hide_launcher,
            relay
        ])
        .setup(|app| {
            let handle = app.handle();
            let global_shortcut = handle.global_shortcut();

            let mut registered = None;
            for (label, shortcut) in shortcut_candidates() {
                if global_shortcut.register(shortcut).is_ok() {
                    registered = Some(label.to_string());
                    break;
                }
            }
            app.manage(RegisteredShortcut(Mutex::new(registered)));

            // A launcher that stays open after you click elsewhere stops being
            // a launcher, so it hides when it loses focus.
            if let Some(window) = app.get_webview_window(LAUNCHER_LABEL) {
                let launcher_handle = handle.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        hide_launcher_window(&launcher_handle);
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running pr0");
}
