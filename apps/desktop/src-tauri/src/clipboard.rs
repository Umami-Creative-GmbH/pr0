/// The native service owns admission. This boundary only performs the OS write.
pub fn write(text: &str) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.set_text(text))
        .map_err(|_| "clipboard_unavailable".into())
}
use std::sync::atomic::{AtomicBool, Ordering};

static COMMAND_BUSY: AtomicBool = AtomicBool::new(false);
pub struct Admission;
impl Drop for Admission {
    fn drop(&mut self) {
        COMMAND_BUSY.store(false, Ordering::Release);
    }
}
/// Reserve before spawn_blocking so an overlapping IPC call cannot become a queued write.
pub fn admit() -> Result<Admission, String> {
    COMMAND_BUSY
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .map(|_| Admission)
        .map_err(|_| "clipboard_busy".into())
}
