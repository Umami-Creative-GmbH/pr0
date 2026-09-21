mod auth;
mod auth_contract;
mod auth_storage;
#[cfg(test)]
mod auth_tests;
mod auth_transport;
mod change_contract;
mod clipboard;
mod deletion_proof;
mod library_contract;
mod library_storage;
mod local_contract;
mod local_search;
mod search_contract;
mod search_query;
mod organization_contract;
mod upload_contract;
mod usage_contract;

use auth::{AuthService, AuthView};
use auth_storage::WindowsCredentials;
use auth_transport::HttpsTransport;
use std::sync::Arc;
use tauri::{Emitter, Manager};

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
async fn library_search(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    request: search_contract::SearchRequest,
) -> Result<search_contract::SearchPage, String> {
    authorize(&window)?;
    request.validate()?;
    let service = state.inner().clone()?;
    let cancelled = service.admit_search(&request.request_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        service.library_search_admitted(request, cancelled)
    })
    .await
    .map_err(|_| "native_unavailable".to_string())?
}
#[tauri::command]
fn library_cancel_search(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    id: String,
) -> Result<(), String> {
    authorize(&window)?;
    state
        .inner()
        .as_ref()
        .map_err(Clone::clone)?
        .cancel_search(&id)
}
#[tauri::command]
async fn library_recover_search(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    request: search_contract::SearchRequest,
) -> Result<(), String> {
    dispatch(window, state, move |service| {
        service.library_recover_search(request)
    })
    .await
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
    request: auth_contract::SignOutRequest,
) -> Result<AuthView, String> {
    dispatch(window, state, move |service| service.transition(request)).await
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
            library_organization,
            library_organize,
            library_organization_review,
            library_organization_impact,
            library_organization_browse,
            library_recovery_browse,
            library_recovery_detail,
            library_pause_download,
            library_download,
            library_upload,
            library_upload_status,
            library_change_status,
            library_sync,
            library_browse,
            library_search,
            library_cancel_search,
            library_recover_search,
            library_detail,
            library_editor,
            library_create,
            library_edit,
            library_copy_draft,
            library_copy,
            library_recents,
            library_usage_status,
            library_retry_usage
        ])
        .plugin(tauri_plugin_clipboard_manager::init())
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
            if let Ok(worker) = &service {
                let worker = worker.clone();
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let _ = worker.restore();
                    let mut previous = String::new();
                    let mut next_check = std::time::Instant::now();
                    loop {
                        let observed = worker.sync_generation();
                        if std::time::Instant::now() >= next_check {
                            let _ = worker.refresh();
                            next_check =
                                std::time::Instant::now() + std::time::Duration::from_secs(30);
                        }
                        if worker.library_reconcile().is_ok() {
                            let _ = worker.library_upload();
                        }
                        let _ = worker.library_sync_usage();
                        let state = serde_json::to_string(&(
                            worker.status(),
                            worker.library_upload_status(),
                            worker.library_status(),
                            worker.library_usage_status(),
                        ))
                        .unwrap_or_default();
                        if state != previous {
                            let _ = handle.emit("auth-changed", ());
                            let _ = handle.emit("library-changed", ());
                            previous = state;
                        }
                        worker.wait_for_sync(observed, std::time::Duration::from_secs(1));
                    }
                });
                let worker = service.as_ref().expect("initialized service").clone();
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut previous = String::new();
                    loop {
                        let observed = worker.sync_generation();
                        let progressed = if worker
                            .library_status()
                            .is_ok_and(|status| !status.complete && !status.paused)
                        {
                            worker.library_download().is_ok()
                        } else {
                            worker.library_changes(25).is_ok()
                        };
                        let state = serde_json::to_string(&(
                            worker.library_change_status(),
                            worker.library_status(),
                        ))
                        .unwrap_or_default();
                        if state != previous {
                            let _ = handle.emit("library-changed", ());
                            previous = state;
                        }
                        // Drain complete pages immediately; pause only blocked or unavailable work.
                        let ready = progressed
                            && worker.library_status().is_ok_and(|status| !status.paused)
                            && worker.library_change_status().is_ok_and(|status| {
                                status.updating
                                    && status.error.is_none()
                                    && status.retry_after_ms == 0
                            });
                        if !ready {
                            worker.wait_for_sync(observed, std::time::Duration::from_secs(1));
                        }
                    }
                });
            }
            app.manage(service);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(true)) {
                if let Ok(service) = window.state::<ManagedAuth>().inner() {
                    service.wake_sync();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("pr0 could not start");
}

#[tauri::command]
async fn library_copy(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    request: usage_contract::CopyRequest,
) -> Result<usage_contract::CopyResult, String> {
    let _admission = clipboard::admit()?;
    let app = window.app_handle().clone();
    let events = app.clone();
    let result = dispatch(window, state, move |service| {
        service.library_copy(request, clipboard::write)
    })
    .await?;
    let _ = events.emit("library-changed", ());
    Ok(result)
}
#[tauri::command]
async fn library_recents(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    offset: u32,
) -> Result<Vec<library_contract::Summary>, String> {
    dispatch(window, state, move |service| {
        service.library_recents(offset)
    })
    .await
}
#[tauri::command]
async fn library_usage_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<usage_contract::UsageStatus, String> {
    dispatch(window, state, AuthService::library_usage_status).await
}
#[tauri::command]
async fn library_retry_usage(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<usage_contract::UsageStatus, String> {
    let app = window.app_handle().clone();
    let result = dispatch(window, state, AuthService::library_retry_usage).await?;
    let _ = app.emit("library-changed", ());
    Ok(result)
}

#[tauri::command]
async fn library_upload_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<upload_contract::UploadStatus, String> {
    dispatch(window, state, AuthService::library_upload_status).await
}
#[tauri::command]
async fn library_organization(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<serde_json::Value, String> {
    dispatch(window, state, AuthService::library_organization).await
}
#[tauri::command]
async fn library_organize(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    request: organization_contract::OrganizeRequest,
) -> Result<serde_json::Value, String> {
    let app = window.app_handle().clone();
    let result = dispatch(window, state, move |service| {
        let result = service.library_organize(request);
        service.wake_sync();
        result
    })
    .await?;
    let _ = app.emit("library-changed", ());
    Ok(result)
}
#[tauri::command]
async fn library_organization_review(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    id: String,
    offset: u32,
) -> Result<serde_json::Value, String> {
    dispatch(window, state, move |service| {
        service.library_organization_review(&id, offset)
    })
    .await
}
#[tauri::command]
async fn library_organization_impact(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    action: organization_contract::OrganizationAction,
    replaces: Option<String>,
) -> Result<serde_json::Value, String> {
    dispatch(window, state, move |service| {
        service.library_organization_impact(action, replaces)
    })
    .await
}
#[tauri::command]
async fn library_organization_browse(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    request: organization_contract::OrganizationBrowse,
) -> Result<Vec<library_contract::Summary>, String> {
    dispatch(window, state, move |service| {
        service.library_organization_browse(request)
    })
    .await
}
#[tauri::command]
async fn library_upload(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<upload_contract::UploadStatus, String> {
    dispatch(window, state, AuthService::library_upload).await
}
#[tauri::command]
async fn library_editor(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    id: String,
) -> Result<local_contract::LocalPrompt, String> {
    dispatch(window, state, move |service| service.library_editor(&id)).await
}

async fn save_command(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    request: local_contract::SaveRequest,
    create: bool,
) -> Result<local_contract::LocalPrompt, String> {
    let app = window.app_handle().clone();
    let result = dispatch(window, state, move |service| {
        let result = if create {
            service.library_create(request)
        } else {
            service.library_edit(request)
        };
        service.wake_sync();
        result
    })
    .await?;
    // Events only invalidate views. A lost event cannot change storage truth.
    let _ = app.emit("library-changed", &result.local_revision);
    Ok(result)
}

#[tauri::command]
async fn library_change_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<change_contract::ChangeStatus, String> {
    dispatch(window, state, AuthService::library_change_status).await
}
#[tauri::command]
async fn library_sync(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
) -> Result<(), String> {
    dispatch(window, state, |service| {
        service.wake_sync();
        Ok(())
    })
    .await
}
#[tauri::command]
async fn library_create(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    request: local_contract::SaveRequest,
) -> Result<local_contract::LocalPrompt, String> {
    save_command(window, state, request, true).await
}
#[tauri::command]
async fn library_edit(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    request: local_contract::SaveRequest,
) -> Result<local_contract::LocalPrompt, String> {
    save_command(window, state, request, false).await
}
#[tauri::command]
async fn library_copy_draft(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    instance_id: String,
    account_id: String,
    generation: u64,
    text: String,
) -> Result<(), String> {
    let _admission = clipboard::admit()?;
    dispatch(window, state, move |service| {
        service.copy_draft(
            &instance_id,
            &account_id,
            generation,
            &text,
            clipboard::write,
        )
    })
    .await
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
async fn library_recovery_browse(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    offset: u32,
) -> Result<Vec<library_contract::RecoverySummary>, String> {
    dispatch(window, state, move |service| {
        service.library_recovery_browse(offset)
    })
    .await
}
#[tauri::command]
async fn library_recovery_detail(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    snapshot_id: String,
    id: String,
) -> Result<library_contract::Prompt, String> {
    dispatch(window, state, move |service| {
        service.library_recovery_detail(&snapshot_id, &id)
    })
    .await
}
#[tauri::command]
async fn library_pause_download(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ManagedAuth>,
    paused: bool,
) -> Result<library_contract::LibraryStatus, String> {
    dispatch(window, state, move |service| {
        service.library_pause_download(paused)
    })
    .await
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
