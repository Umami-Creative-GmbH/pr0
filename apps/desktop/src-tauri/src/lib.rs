mod auth;
mod auth_contract;
mod auth_storage;
#[cfg(test)]
mod auth_tests;
mod auth_transport;
mod library_contract;
mod library_storage;

use auth::{AuthService, AuthView};
use auth_storage::WindowsCredentials;
use auth_transport::HttpsTransport;
use std::sync::Arc;
use tauri::Manager;

type ManagedAuth = Result<Arc<AuthService>, String>;

fn authorize(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "forbidden")?;
    let local = url.scheme() == "tauri" && url.host_str() == Some("localhost")
        || url.scheme() == "http" && url.host_str() == Some("tauri.localhost")
        || cfg!(debug_assertions) && url.origin().ascii_serialization() == "http://localhost:1420";
    if window.label() != "main" || !local {
        return Err("forbidden".into());
    }
    Ok(())
}

async fn dispatch<T: Send + 'static>(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    operation: impl FnOnce(&AuthService) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    authorize(&window)?;
    let service = state.inner().clone()?;
    tauri::async_runtime::spawn_blocking(move || operation(&service))
        .await
        .map_err(|_| "native_unavailable".to_string())?
}

#[tauri::command]
async fn auth_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<AuthView, String> {
    dispatch(window, state, AuthService::restore).await
}
#[tauri::command]
async fn auth_begin(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    origin: String,
) -> Result<AuthView, String> {
    dispatch(window, state, move |service| service.begin(&origin)).await
}
#[tauri::command]
async fn auth_poll(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<AuthView, String> {
    dispatch(window, state, AuthService::poll).await
}
#[tauri::command]
async fn auth_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<AuthView, String> {
    dispatch(window, state, AuthService::cancel).await
}
#[tauri::command]
async fn auth_open_browser(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<AuthView, String> {
    dispatch(window, state, AuthService::open_browser).await
}
#[tauri::command]
async fn auth_refresh(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<AuthView, String> {
    dispatch(window, state, AuthService::refresh).await
}
#[tauri::command]
async fn auth_sign_out(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<AuthView, String> {
    dispatch(window, state, AuthService::sign_out).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            auth_status,
            auth_begin,
            auth_poll,
            auth_cancel,
            auth_open_browser,
            auth_refresh,
            auth_sign_out,
            library_status,
            library_download,
            library_browse,
            library_detail
        ])
        .setup(|app| {
            let service: ManagedAuth = (|| {
                let directory = app
                    .path()
                    .app_local_data_dir()
                    .map_err(|_| "storage_unavailable")?
                    .join("account-session");
                Ok(Arc::new(AuthService::new(
                    directory,
                    Arc::new(HttpsTransport::new()?),
                    Arc::new(WindowsCredentials::new("pr0:desktop:active:v1".into())),
                )?))
            })();
            app.manage(service);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("pr0 could not start");
}

#[tauri::command]
async fn library_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<library_contract::LibraryStatus, String> {
    dispatch(window, state, AuthService::library_status).await
}
#[tauri::command]
async fn library_download(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<library_contract::LibraryStatus, String> {
    dispatch(window, state, AuthService::library_download).await
}
#[tauri::command]
async fn library_browse(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    offset: u32,
) -> Result<Vec<library_contract::Summary>, String> {
    dispatch(window, state, move |service| service.library_browse(offset)).await
}
#[tauri::command]
async fn library_detail(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    id: String,
) -> Result<library_contract::Prompt, String> {
    dispatch(window, state, move |service| service.library_detail(&id)).await
}
