use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    pub state: StartupState,
    pub offer: bool,
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum StartupState {
    Enabled,
    Disabled,
    DisabledByWindows,
    Unavailable,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupAction {
    Enable,
    Disable,
    DismissOffer,
}

pub struct Startup {
    marker: PathBuf,
    lock: Mutex<()>,
    #[cfg(windows)]
    registration: crate::startup_windows::Registration,
}

impl Startup {
    #[cfg(all(test, windows))]
    pub fn isolated(directory: PathBuf, root: String) -> Self {
        Self {
            marker: directory.join("startup-offered"),
            lock: Mutex::new(()),
            registration: crate::startup_windows::Registration::isolated("pr0-test".into(), root),
        }
    }
    pub fn new(directory: PathBuf, name: String) -> Self {
        Self {
            marker: directory.join("startup-offered"),
            lock: Mutex::new(()),
            #[cfg(windows)]
            registration: crate::startup_windows::Registration::new(name),
        }
    }
    fn read(&self) -> Result<StartupStatus, String> {
        let offer = !self
            .marker
            .try_exists()
            .map_err(|_| "storage_unavailable")?;
        #[cfg(windows)]
        let state = self
            .registration
            .status()
            .unwrap_or(StartupState::Unavailable);
        #[cfg(not(windows))]
        let state = StartupState::Unavailable;
        Ok(StartupStatus { state, offer })
    }
    pub fn status(&self) -> Result<StartupStatus, String> {
        let _guard = self.lock.lock().map_err(|_| "startup_unavailable")?;
        self.read()
    }
    pub fn action(&self, action: StartupAction) -> Result<StartupStatus, String> {
        let _guard = self.lock.lock().map_err(|_| "startup_unavailable")?;
        match action {
            StartupAction::DismissOffer => {
                let file =
                    std::fs::File::create(&self.marker).map_err(|_| "storage_unavailable")?;
                file.sync_all().map_err(|_| "storage_unavailable")?;
            }
            #[cfg(windows)]
            StartupAction::Enable => self.registration.set(true)?,
            #[cfg(windows)]
            StartupAction::Disable => self.registration.set(false)?,
            #[cfg(not(windows))]
            _ => return Err("startup_unavailable".into()),
        }
        self.read()
    }
}
