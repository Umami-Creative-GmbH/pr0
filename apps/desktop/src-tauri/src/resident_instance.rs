//! Acquire the writer before Tauri creates windows, credentials, tray or workers.
//! A named auto-reset event retains activation across the startup window gap.
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions, TryLockError};
use std::path::Path;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows_sys::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};

struct Activation(HANDLE);
// Windows event handles support cross-thread signal/wait; ownership closes once.
unsafe impl Send for Activation {}
unsafe impl Sync for Activation {}
impl Drop for Activation {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub struct Instance {
    _writer: File,
    activation: Activation,
}
impl Instance {
    pub fn listen(self: std::sync::Arc<Self>, handle: tauri::AppHandle) {
        std::thread::spawn(move || loop {
            if self.wait_for_activation(u32::MAX) {
                let app = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    let _ = crate::show_library(&app);
                });
            }
        });
    }
    pub fn acquire(directory: &Path) -> std::io::Result<Option<Self>> {
        std::fs::create_dir_all(directory)?;
        let directory = directory.canonicalize()?;
        let identity = directory.to_string_lossy().to_lowercase();
        let hash = format!("{:x}", Sha256::digest(identity.as_bytes()));
        let name: Vec<u16> = format!("Global\\pr0-activation-{hash}\0")
            .encode_utf16()
            .collect();
        // Create/open BEFORE the lock. A losing launch can signal even when the
        // winner has not reached native setup. Default ACL is the user's token.
        let handle = unsafe { CreateEventW(std::ptr::null(), 0, 0, name.as_ptr()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let activation = Activation(handle);
        let writer = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory.join("resident.lock"))?;
        match writer.try_lock() {
            Ok(()) => Ok(Some(Self {
                _writer: writer,
                activation,
            })),
            Err(TryLockError::WouldBlock) => {
                if unsafe { SetEvent(activation.0) } == 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(None)
            }
            Err(TryLockError::Error(error)) => Err(error),
        }
    }
    pub fn wait_for_activation(&self, timeout_ms: u32) -> bool {
        unsafe { WaitForSingleObject(self.activation.0, timeout_ms) == WAIT_OBJECT_0 }
    }
}
