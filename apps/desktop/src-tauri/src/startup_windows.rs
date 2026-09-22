//! Per-user Run registration. StartupApproved is read conservatively and never
//! reset: an external Windows disablement requires Windows Settings to re-enable.
use crate::startup::StartupState;
use std::io::{self, ErrorKind};
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_BINARY};
use winreg::RegKey;

pub struct Registration {
    name: String,
    root: String,
}

fn optional<T>(result: io::Result<T>) -> io::Result<Option<T>> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

impl Registration {
    pub fn new(name: String) -> Self {
        Self {
            name,
            root: r"Software\Microsoft\Windows\CurrentVersion".into(),
        }
    }
    #[cfg(test)]
    pub fn isolated(name: String, root: String) -> Self {
        Self { name, root }
    }
    fn command(&self) -> Result<String, String> {
        let executable = std::env::current_exe().map_err(|_| "startup_unavailable")?;
        let executable = executable.to_str().ok_or("startup_unavailable")?;
        let command = format!("\"{executable}\" --startup");
        // Windows Run values are limited to 260 characters, including arguments.
        if command.encode_utf16().count() > 260 || executable.contains('"') {
            return Err("startup_path_too_long".into());
        }
        Ok(command)
    }
    fn key(&self, suffix: &str, access: u32) -> io::Result<Option<RegKey>> {
        optional(
            RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey_with_flags(format!("{}\\{suffix}", self.root), access),
        )
    }
    pub fn status(&self) -> Result<StartupState, String> {
        let Some(run) = self
            .key("Run", KEY_READ)
            .map_err(|_| "startup_unavailable")?
        else {
            return Ok(StartupState::Disabled);
        };
        let command: Option<String> =
            optional(run.get_value(&self.name)).map_err(|_| "startup_unavailable")?;
        let Some(command) = command else {
            return Ok(StartupState::Disabled);
        };
        if command != self.command()? {
            return Err("startup_registration_mismatch".into());
        }
        let approval = self
            .key(r"Explorer\StartupApproved\Run", KEY_READ)
            .map_err(|_| "startup_unavailable")?;
        if let Some(approval) = approval {
            if let Some(value) =
                optional(approval.get_raw_value(&self.name)).map_err(|_| "startup_unavailable")?
            {
                if value.vtype != REG_BINARY || value.bytes.len() != 12 {
                    return Err("startup_unavailable".into());
                }
                let flag = u32::from_le_bytes(
                    value.bytes[..4]
                        .try_into()
                        .map_err(|_| "startup_unavailable")?,
                );
                match flag {
                    0 | 2 => {}
                    3 | 7 => return Ok(StartupState::DisabledByWindows),
                    // Unknown Windows encodings must not masquerade as enabled.
                    _ => return Err("startup_unavailable".into()),
                }
            }
        }
        Ok(StartupState::Enabled)
    }
    pub fn set(&self, enabled: bool) -> Result<(), String> {
        if enabled {
            let command = self.command()?;
            let access = KEY_SET_VALUE;
            // Test-only external-effect control: ask Windows for a read-only
            // handle so the real registry write returns access denied.
            #[cfg(test)]
            let access = if std::env::var("PR0_TEST_STARTUP_DENY_WRITE").as_deref() == Ok("true") {
                KEY_READ
            } else {
                access
            };
            let (run, _) = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey_with_flags(format!("{}\\Run", self.root), access)
                .map_err(|_| "startup_registration_failed")?;
            run.set_value(&self.name, &command)
                .map_err(|_| "startup_registration_failed")?;
        } else if let Some(run) = self
            .key("Run", KEY_SET_VALUE)
            .map_err(|_| "startup_registration_failed")?
        {
            optional(run.delete_value(&self.name)).map_err(|_| "startup_registration_failed")?;
        }
        let state = self.status()?;
        if enabled && state == StartupState::DisabledByWindows {
            return Err("startup_disabled_by_windows".into());
        }
        if state
            != if enabled {
                StartupState::Enabled
            } else {
                StartupState::Disabled
            }
        {
            return Err("startup_registration_failed".into());
        }
        Ok(())
    }
}
