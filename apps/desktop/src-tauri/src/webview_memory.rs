//! Visibility-based cache hints preserve scripts, drafts and native synchronization.
use tauri::{AppHandle, Manager};

pub fn update(app: &AppHandle, label: &str) {
    #[cfg(windows)]
    if let Some(window) = app.get_webview_window(label) {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;
        let current = window.clone();
        let _ = window.with_webview(move |platform| {
            let active =
                current.is_visible().unwrap_or(true) && !current.is_minimized().unwrap_or(false);
            // The controller and its COM interfaces are used only on the UI thread.
            // Older runtimes may lack this optional, best-effort memory hint.
            unsafe {
                if let Ok(webview) = platform
                    .controller()
                    .CoreWebView2()
                    .and_then(|webview| webview.cast::<ICoreWebView2_19>())
                {
                    let _ = webview.SetMemoryUsageTargetLevel(if active {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    });
                }
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (app, label);
}

pub fn initialize(app: &AppHandle) {
    for label in app.webview_windows().keys() {
        update(app, label);
    }
}
