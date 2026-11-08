//! Deterministic ordering for native public-command validation regressions only.
use std::{
    cell::RefCell,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
thread_local! { static GATE: RefCell<Option<Arc<Gate>>> = const { RefCell::new(None) }; }
pub struct Gate {
    reached: AtomicBool,
    released: AtomicBool,
    finished: AtomicBool,
    unavailable: bool,
}
pub fn pause_next(unavailable: bool) -> Arc<Gate> {
    let gate = Arc::new(Gate {
        reached: AtomicBool::new(false),
        released: AtomicBool::new(false),
        finished: AtomicBool::new(false),
        unavailable,
    });
    GATE.with(|slot| slot.replace(Some(gate.clone())));
    gate
}
pub fn take() -> Option<Arc<Gate>> {
    GATE.with(|slot| slot.take())
}
pub fn install(gate: Option<Arc<Gate>>) {
    GATE.with(|slot| slot.replace(gate));
}
pub fn after_snapshot(cancelled: &AtomicBool) -> Result<(), String> {
    if let Ok(directory) = std::env::var("PR0_SEARCH_VALIDATION_TEST_GATE") {
        let directory = std::path::PathBuf::from(directory);
        std::fs::write(directory.join("snapshot-ready"), b"ready")
            .map_err(|_| "validation_test_gate")?;
        let deadline = Instant::now() + Duration::from_secs(30);
        while !directory.join("release").exists() {
            if cancelled.load(Ordering::Acquire) || Instant::now() >= deadline {
                return Err("operation_cancelled".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    if let Some(gate) = GATE.with(|slot| slot.borrow().clone()) {
        gate.reached.store(true, Ordering::Release);
        while !gate.released.load(Ordering::Acquire) {
            if cancelled.load(Ordering::Acquire) {
                return Err("operation_cancelled".into());
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        if gate.unavailable {
            return Err("validation_test_unavailable".into());
        }
    }
    Ok(())
}
pub fn finish() {
    if let Some(gate) = take() {
        gate.finished.store(true, Ordering::Release);
    }
}
impl Gate {
    fn wait(flag: &AtomicBool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !flag.load(Ordering::Acquire) {
            assert!(
                Instant::now() < deadline,
                "Validation ordering gate timed out"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    pub fn wait_reached(&self) {
        Self::wait(&self.reached);
    }
    pub fn release(&self) {
        self.released.store(true, Ordering::Release);
    }
    pub fn wait_finished(&self) {
        Self::wait(&self.finished);
    }
}

pub fn before_field(field: &str) {
    if field == "content" {
        if let Ok(directory) = std::env::var("PR0_SEARCH_VALIDATION_TEST_GATE") {
            std::fs::write(
                std::path::PathBuf::from(directory).join("content-check-started"),
                b"ready",
            )
            .unwrap();
        }
    }
}

// Force a real SQLite backup SQLITE_FULL without filling the host volume.
pub fn before_backup(snapshot: &rusqlite::Connection) -> Result<(), String> {
    if std::env::var("PR0_SEARCH_VALIDATION_TEST_MAX_PAGES").as_deref() == Ok("1") {
        snapshot
            .pragma_update(None, "max_page_count", 1)
            .map_err(super::super::library_storage::io)?;
    }
    Ok(())
}
pub fn backup_error(error: &rusqlite::Error) -> Result<(), String> {
    if error.sqlite_error_code() == Some(rusqlite::ErrorCode::DiskFull) {
        if let Ok(directory) = std::env::var("PR0_SEARCH_VALIDATION_TEST_GATE") {
            std::fs::write(
                std::path::PathBuf::from(directory).join("backup-disk-full"),
                b"SQLITE_FULL",
            )
            .map_err(|_| "validation_test_gate")?;
        }
    }
    Ok(())
}
