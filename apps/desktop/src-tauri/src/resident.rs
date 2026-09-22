use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentStatus {
    pub quit_requested: bool,
    pub update_requested: bool,
    pub close_notice: bool,
    pub settings: bool,
    pub saving: u32,
    pub quitting: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResidentAction {
    Quit,
    CancelQuit,
    Close,
    CancelClose,
    Settings,
    CloseSettings,
}

#[derive(Default)]
pub struct Resident(Mutex<ResidentStatus>);

impl Resident {
    pub fn status(&self) -> Result<ResidentStatus, String> {
        Ok(self.0.lock().map_err(|_| "resident_unavailable")?.clone())
    }
    pub fn action(&self, action: ResidentAction) -> Result<(), String> {
        let mut state = self.0.lock().map_err(|_| "resident_unavailable")?;
        if state.quitting {
            return Err("quitting".into());
        }
        match action {
            ResidentAction::Quit => {
                state.update_requested = false;
                state.quit_requested = true;
                state.close_notice = false;
                state.settings = false;
            }
            ResidentAction::CancelQuit => {
                state.quit_requested = false;
                state.update_requested = false;
            }
            ResidentAction::Close if !state.quit_requested => {
                state.close_notice = true;
                state.settings = false;
            }
            ResidentAction::Close => {}
            ResidentAction::CancelClose => state.close_notice = false,
            ResidentAction::Settings if !state.quit_requested => {
                state.settings = true;
                state.close_notice = false;
            }
            ResidentAction::Settings => {}
            ResidentAction::CloseSettings => state.settings = false,
        }
        Ok(())
    }
    pub fn begin_save(&self) -> Result<(), String> {
        let mut state = self.0.lock().map_err(|_| "resident_unavailable")?;
        if state.quitting {
            return Err("quitting".into());
        }
        state.saving += 1;
        Ok(())
    }
    pub fn request_update(&self) -> Result<(), String> {
        let mut state = self.0.lock().map_err(|_| "resident_unavailable")?;
        if state.quitting || state.quit_requested {
            return Err("quit_in_progress".into());
        }
        state.quit_requested = true;
        state.update_requested = true;
        state.settings = false;
        state.close_notice = false;
        Ok(())
    }
    pub fn cancel_failed_update(&self) -> Result<(), String> {
        let mut state = self.0.lock().map_err(|_| "resident_unavailable")?;
        state.quitting = false;
        state.quit_requested = false;
        state.update_requested = false;
        Ok(())
    }
    pub fn end_save(&self) {
        if let Ok(mut state) = self.0.lock() {
            state.saving = state.saving.saturating_sub(1);
        }
    }
    pub fn finish_quit(&self) -> Result<(), String> {
        let mut state = self.0.lock().map_err(|_| "resident_unavailable")?;
        if state.saving != 0 {
            return Err("save_in_progress".into());
        }
        if !state.quit_requested {
            return Err("quit_not_requested".into());
        }
        state.quitting = true;
        Ok(())
    }
}
