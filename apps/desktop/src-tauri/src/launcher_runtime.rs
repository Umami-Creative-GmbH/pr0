use serde::Serialize;
use std::sync::Mutex;

const CANDIDATES: [&str; 4] = [
    "Ctrl+Shift+P",
    "Alt+Space",
    "Ctrl+Alt+P",
    "Ctrl+Shift+Space",
];

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowStatus {
    pub opening: u64,
    pub visible: bool,
    pub focused: bool,
    pub shortcut: Option<String>,
}
#[derive(Default)]
pub struct Launcher {
    state: Mutex<WindowStatus>,
    registration: Mutex<()>,
}
impl Launcher {
    pub fn status(&self) -> Result<WindowStatus, String> {
        Ok(self.state.lock().map_err(|_| "state_unavailable")?.clone())
    }
    pub fn register(&self, mut register: impl FnMut(&str) -> bool) -> Result<(), String> {
        let _registration = self
            .registration
            .try_lock()
            .map_err(|_| "registration_busy")?;
        if self.status()?.shortcut.is_some() {
            return Ok(());
        }
        let shortcut = CANDIDATES.into_iter().find(|candidate| register(candidate));
        self.state.lock().map_err(|_| "state_unavailable")?.shortcut = shortcut.map(String::from);
        Ok(())
    }
    pub fn open(&self) -> Result<u64, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        state.opening += 1;
        state.visible = true;
        state.focused = false;
        Ok(state.opening)
    }
    // An OS focus event (or is_focused), never a successful set_focus call, enables blur dismissal.
    pub fn observe_focus(&self, focused: bool) -> Result<bool, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if !state.visible {
            return Ok(false);
        }
        if focused {
            state.focused = true;
            return Ok(false);
        }
        if state.focused {
            state.focused = false;
            state.visible = false;
            return Ok(true);
        }
        Ok(false)
    }
    pub fn hide(&self, opening: u64) -> Result<bool, String> {
        let mut state = self.state.lock().map_err(|_| "state_unavailable")?;
        if state.opening != opening || !state.visible {
            return Ok(false);
        }
        state.visible = false;
        state.focused = false;
        Ok(true)
    }
    pub fn require_opening(&self, opening: u64) -> Result<(), String> {
        let state = self.status()?;
        if !state.visible || state.opening != opening {
            return Err("operation_cancelled".into());
        }
        Ok(())
    }
}
