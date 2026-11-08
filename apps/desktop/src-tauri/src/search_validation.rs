#[cfg(test)]
#[path = "search_validation_fixture.rs"]
pub mod testing;
// Validate a private snapshot without blocking the library owner or trusting unchecked postings.
use rusqlite::{
    backup::{Backup, StepResult},
    Connection, InterruptHandle, OpenFlags,
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, TryRecvError},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

pub enum Outcome {
    Pending,
    Valid {
        projection_revision: i64,
        source_data_version: i64,
    },
    Corrupt {
        projection_revision: i64,
        source_data_version: i64,
    },
    Unavailable,
}

pub struct Validation {
    cancelled: Arc<AtomicBool>,
    interrupts: Arc<Mutex<Vec<InterruptHandle>>>,
    worker: Option<JoinHandle<()>>,
    result: Receiver<Outcome>,
}
impl Validation {
    pub fn start(path: PathBuf, data_version: i64) -> Self {
        let cancelled = Arc::new(AtomicBool::new(false));
        let interrupts = Arc::new(Mutex::new(Vec::new()));
        let cancel = cancelled.clone();
        let handles = interrupts.clone();
        let (sender, result) = mpsc::channel();
        #[cfg(test)]
        let gate = testing::take();
        let worker = std::thread::Builder::new()
            .name("pr0-search-check".into())
            .spawn(move || {
                #[cfg(test)]
                testing::install(gate);
                let result =
                    validate(path, data_version, &cancel, &handles).unwrap_or(Outcome::Unavailable);
                let _ = sender.send(result);
                #[cfg(test)]
                testing::finish();
            })
            .ok();
        Self {
            cancelled,
            interrupts,
            worker,
            result,
        }
    }
    pub fn poll(&mut self) -> Outcome {
        self.result.try_recv().unwrap_or_else(|error| match error {
            TryRecvError::Empty => Outcome::Pending,
            TryRecvError::Disconnected => Outcome::Unavailable,
        })
    }
}

impl Drop for Validation {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        if let Ok(handles) = self.interrupts.lock() {
            for handle in handles.iter() {
                handle.interrupt();
            }
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
fn validate(
    path: PathBuf,
    data_version: i64,
    cancelled: &Arc<AtomicBool>,
    interrupts: &Mutex<Vec<InterruptHandle>>,
) -> Result<Outcome, String> {
    use super::library_storage::io;
    let deadline = Instant::now() + Duration::from_secs(30);
    let source = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(io)?;
    source.busy_timeout(Duration::from_millis(25)).map_err(io)?;
    source
        .execute_batch("PRAGMA cache_size=-2048; PRAGMA mmap_size=0;")
        .map_err(io)?;
    // SQLite owns an unnamed, delete-on-close temporary database. It can spill to
    // disk and cannot leave a named account snapshot after cancellation or a crash.
    super::migration_backup::preflight(
        &source,
        &std::env::temp_dir().join("pr0-search-validation.sqlite"),
    )?;
    let mut snapshot = Connection::open("").map_err(io)?;
    snapshot
        .execute_batch("PRAGMA temp_store=FILE; PRAGMA cache_size=-8192; PRAGMA mmap_size=0;")
        .map_err(io)?;
    {
        let mut handles = interrupts.lock().map_err(|_| "storage_unavailable")?;
        handles.push(source.get_interrupt_handle());
        handles.push(snapshot.get_interrupt_handle());
        if cancelled.load(Ordering::Acquire) {
            return Err("operation_cancelled".into());
        }
    }
    {
        let backup = Backup::new(&source, &mut snapshot).map_err(io)?;
        loop {
            if cancelled.load(Ordering::Acquire) || Instant::now() >= deadline {
                return Err("operation_cancelled".into());
            }
            match backup.step(128).map_err(io)? {
                StepResult::Done => break,
                StepResult::Busy | StepResult::Locked => {
                    std::thread::sleep(Duration::from_millis(5))
                }
                StepResult::More => std::thread::yield_now(),
                _ => return Err("storage_unavailable".into()),
            }
        }
    }
    drop(source);
    #[cfg(test)]
    testing::after_snapshot(cancelled)?;
    let cancel = cancelled.clone();
    snapshot
        .progress_handler(
            1000,
            Some(move || cancel.load(Ordering::Acquire) || Instant::now() >= deadline),
        )
        .map_err(io)?;
    let revision = snapshot
        .query_row("SELECT revision FROM local_state", [], |row| row.get(0))
        .map_err(io)?;
    for field in ["title", "description", "content", "name"] {
        #[cfg(test)]
        testing::before_field(field);
        if cancelled.load(Ordering::Acquire) || Instant::now() >= deadline {
            return Err("operation_cancelled".into());
        }
        if let Err(error) = snapshot.execute_batch(&format!(
            "INSERT INTO local_f_{field}(local_f_{field},rank) VALUES('integrity-check',1);"
        )) {
            return if error.sqlite_error_code() == Some(rusqlite::ErrorCode::DatabaseCorrupt) {
                Ok(Outcome::Corrupt {
                    projection_revision: revision,
                    source_data_version: data_version,
                })
            } else {
                Err(io(error))
            };
        }
    }
    Ok(Outcome::Valid {
        projection_revision: revision,
        source_data_version: data_version,
    })
}
