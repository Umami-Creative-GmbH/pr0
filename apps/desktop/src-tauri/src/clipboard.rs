/// The native service owns admission. This boundary only performs the OS write.
pub fn write(text: &str) -> Result<(), String> {
    #[cfg(test)]
    wait_for_test_clipboard()?;
    arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.set_text(text))
        .map_err(|_| "clipboard_unavailable".into())
}

// Only the opt-in native test process can pause at this external boundary. No values leave memory.
#[cfg(test)]
fn wait_for_test_clipboard() -> Result<(), String> {
    let Some(gate) = std::env::var_os("PR0_TEST_CLIPBOARD_GATE") else {
        return Ok(());
    };
    let gate = std::path::PathBuf::from(gate);
    if !gate.exists() {
        return Ok(());
    }
    std::fs::write(gate.with_extension("entered"), []).map_err(|_| "clipboard_unavailable")?;
    let start = std::time::Instant::now();
    while gate.exists() {
        if start.elapsed() > std::time::Duration::from_secs(10) {
            return Err("clipboard_unavailable".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Ok(())
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
