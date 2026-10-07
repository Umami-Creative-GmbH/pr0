//! Executable updates have no dependency on account/session or instance configuration.
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri_plugin_updater::{Update, Updater};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub phase: &'static str,
    pub version: Option<String>,
    pub error: Option<&'static str>,
}

struct State {
    status: UpdateStatus,
    candidate: Option<Update>,
    verified: Option<Vec<u8>>,
}

pub struct Updates {
    state: Mutex<State>,
    operation: tokio::sync::Mutex<()>,
    marker: PathBuf,
}

impl Updates {
    pub fn new(directory: PathBuf, configured: bool, current: &str) -> Self {
        let marker = directory.join("pending-application-update");
        let error = match std::fs::read_to_string(&marker) {
            Ok(version) if version == current => std::fs::remove_file(&marker)
                .err()
                .map(|_| "storage_unavailable"),
            Ok(_) => Some("install_failed"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => Some("storage_unavailable"),
        };
        Self {
            state: Mutex::new(State {
                status: UpdateStatus {
                    phase: if configured { "idle" } else { "unconfigured" },
                    version: None,
                    error,
                },
                candidate: None,
                verified: None,
            }),
            operation: tokio::sync::Mutex::new(()),
            marker,
        }
    }
    pub fn status(&self) -> Result<UpdateStatus, String> {
        Ok(self
            .state
            .lock()
            .map_err(|_| "update_unavailable")?
            .status
            .clone())
    }
    pub async fn check(&self, updater: Updater) -> Result<(), String> {
        let _operation = self.operation.try_lock().map_err(|_| "update_busy")?;
        {
            let mut state = self.state.lock().map_err(|_| "update_unavailable")?;
            if state.verified.is_some() {
                return Err("update_already_prepared".into());
            }
            state.status = UpdateStatus {
                phase: "checking",
                version: None,
                // Background checks must not erase recovery from the previous
                // installer attempt before the user can read it.
                error: state
                    .status
                    .error
                    .filter(|error| matches!(*error, "install_failed" | "storage_unavailable")),
            };
            state.candidate = None;
        }
        let result = updater.check().await;
        let mut state = self.state.lock().map_err(|_| "update_unavailable")?;
        match result {
            Ok(Some(update))
                if download_transport_allowed(&update.download_url)
                    && update.version.len() <= 128 =>
            {
                state.status.phase = "available";
                state.status.version = Some(update.version.clone());
                state.candidate = Some(update);
            }
            Ok(None) => state.status.phase = "current",
            _ => {
                state.status.phase = "idle";
                state.status.error.get_or_insert("check_failed");
            }
        }
        Ok(())
    }
    pub async fn download(&self) -> Result<(), String> {
        let _operation = self.operation.try_lock().map_err(|_| "update_busy")?;
        let update = {
            let mut state = self.state.lock().map_err(|_| "update_unavailable")?;
            if state.verified.is_some() {
                return Err("update_already_prepared".into());
            }
            let candidate = state.candidate.clone().ok_or("update_not_available")?;
            state.status.phase = "downloading";
            state.status.error = None;
            candidate
        };
        // Tauri validates both the artifact signature and its signed version.
        // Unverified bytes never enter the installable state.
        let result = update.download(|_, _| {}, || {}).await;
        let mut state = self.state.lock().map_err(|_| "update_unavailable")?;
        match result {
            Ok(bytes) => {
                state.verified = Some(bytes);
                state.status.phase = "ready";
            }
            Err(error) => {
                use tauri_plugin_updater::Error;
                state.status.phase = "available";
                state.status.error = Some(match error {
                    Error::Minisign(_)
                    | Error::Base64(_)
                    | Error::SignatureUtf8(_)
                    | Error::MissingSignedVersion
                    | Error::SignedVersionMismatch { .. } => "verification_failed",
                    _ => "download_failed",
                });
            }
        }
        Ok(())
    }
    pub fn request_install(&self, resident: &crate::resident::Resident) -> Result<(), String> {
        let _operation = self.operation.try_lock().map_err(|_| "update_busy")?;
        let state = self.state.lock().map_err(|_| "update_unavailable")?;
        if state.verified.is_none() {
            return Err("update_not_verified".into());
        }
        resident.request_update()
    }
    pub fn install(&self) -> Result<(), String> {
        let _operation = self.operation.try_lock().map_err(|_| "update_busy")?;
        let mut state = self.state.lock().map_err(|_| "update_unavailable")?;
        let update = state.candidate.as_ref().ok_or("update_not_available")?;
        let bytes = state.verified.as_ref().ok_or("update_not_verified")?;
        // Separate from library storage. A subsequent launch of the old version
        // explains a cancelled/failed installer, without touching pending work.
        let result = (|| {
            use std::io::Write;
            let mut marker =
                std::fs::File::create(&self.marker).map_err(|_| "storage_unavailable")?;
            marker
                .write_all(update.version.as_bytes())
                .and_then(|_| marker.sync_all())
                .map_err(|_| "storage_unavailable")?;
            update.install(bytes).map_err(|_| "install_failed")
        })();
        // On Windows success exits the process. Errors leave the resident usable.
        state.status.error = Some(result.err().unwrap_or("install_failed"));
        state.status.phase = "ready";
        Err(state.status.error.unwrap().into())
    }
}

fn download_transport_allowed(url: &url::Url) -> bool {
    // Unit tests substitute only the transport with a loopback fixture server.
    // No HTTP exception is compiled into a shipped application.
    #[cfg(test)]
    if url.scheme() == "http" && url.host_str() == Some("127.0.0.1") {
        return true;
    }
    url.scheme() == "https"
}
