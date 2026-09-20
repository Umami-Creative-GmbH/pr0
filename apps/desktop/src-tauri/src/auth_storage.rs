use super::auth_contract::Retained;
use rusqlite::{Connection, OptionalExtension};
use std::path::Path;

pub trait Credentials: Send + Sync {
    fn read(&self) -> Result<Option<Vec<u8>>, String>;
    fn write(&self, bytes: &[u8]) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}
pub struct WindowsCredentials {
    target: String,
}
impl WindowsCredentials {
    pub fn new(target: String) -> Self {
        Self { target }
    }
}

#[cfg(windows)]
impl Credentials for WindowsCredentials {
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        use windows_sys::Win32::{Foundation::ERROR_NOT_FOUND, Security::Credentials::*};
        let target: Vec<u16> = self.target.encode_utf16().chain([0]).collect();
        let mut entry = std::ptr::null_mut();
        // Windows allocates this record; copy only the bounded blob, then free it.
        unsafe {
            if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut entry) == 0 {
                return if std::io::Error::last_os_error().raw_os_error()
                    == Some(ERROR_NOT_FOUND as i32)
                {
                    Ok(None)
                } else {
                    Err("credential_unavailable".into())
                };
            }
            let size = (*entry).CredentialBlobSize as usize;
            let result = if size == 0 || size > 2560 {
                Err("credential_invalid".into())
            } else {
                Ok(Some(
                    std::slice::from_raw_parts((*entry).CredentialBlob, size).to_vec(),
                ))
            };
            CredFree(entry.cast());
            result
        }
    }
    fn write(&self, bytes: &[u8]) -> Result<(), String> {
        use windows_sys::Win32::Security::Credentials::*;
        if bytes.is_empty() || bytes.len() > 2560 {
            return Err("credential_too_large".into());
        }
        let mut target: Vec<u16> = self.target.encode_utf16().chain([0]).collect();
        let entry = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: bytes.len() as u32,
            CredentialBlob: bytes.as_ptr().cast_mut(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        if unsafe { CredWriteW(&entry, 0) } == 0 {
            return Err("credential_unavailable".into());
        }
        if self.read()?.as_deref() != Some(bytes) {
            return Err("credential_unavailable".into());
        }
        Ok(())
    }
    fn delete(&self) -> Result<(), String> {
        use windows_sys::Win32::{Foundation::ERROR_NOT_FOUND, Security::Credentials::*};
        let target: Vec<u16> = self.target.encode_utf16().chain([0]).collect();
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
            && std::io::Error::last_os_error().raw_os_error() != Some(ERROR_NOT_FOUND as i32)
        {
            return Err("credential_unavailable".into());
        }
        Ok(())
    }
}
#[cfg(not(windows))]
impl Credentials for WindowsCredentials {
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        Err("windows_required".into())
    }
    fn write(&self, _: &[u8]) -> Result<(), String> {
        Err("windows_required".into())
    }
    fn delete(&self) -> Result<(), String> {
        Err("windows_required".into())
    }
}

pub struct Metadata {
    connection: Connection,
}
impl Metadata {
    pub fn open(directory: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(directory).map_err(|_| "storage_unavailable")?;
        let connection = Connection::open(directory.join("session-state.sqlite"))
            .map_err(|_| "storage_unavailable")?;
        let version: u32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|_| "storage_unavailable")?;
        if version > 1 {
            return Err("local_update_required".into());
        }
        connection
            .execute_batch("PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;")
            .map_err(|_| "storage_unavailable")?;
        if version == 0 {
            connection.execute_batch("BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS active_session (singleton INTEGER PRIMARY KEY CHECK(singleton=1), metadata TEXT NOT NULL); PRAGMA user_version=1; COMMIT;").map_err(|_| "storage_unavailable")?;
        }
        Ok(Self { connection })
    }
    pub fn read(&self) -> Result<Option<Retained>, String> {
        let row: Option<String> = self
            .connection
            .query_row(
                "SELECT metadata FROM active_session WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "storage_unavailable")?;
        row.map(|value| {
            serde_json::from_str(&value).map_err(|_| "retained_identity_invalid".into())
        })
        .transpose()
    }
    pub fn save(&self, value: &Retained) -> Result<(), String> {
        let json = serde_json::to_string(value).map_err(|_| "storage_unavailable")?;
        self.connection.execute("INSERT INTO active_session(singleton,metadata) VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET metadata=excluded.metadata", [json]).map_err(|_| "storage_unavailable")?;
        Ok(())
    }
    pub fn clear(&self) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM active_session WHERE singleton=1", [])
            .map_err(|_| "storage_unavailable")?;
        Ok(())
    }
}
