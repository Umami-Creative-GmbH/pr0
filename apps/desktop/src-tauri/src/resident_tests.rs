use crate::resident::{Resident, ResidentAction};

// Test-only storage boundary controls. The real command, SQLite transaction,
// acknowledgement and production WebView remain in the path.
pub fn prepare_save() {
    let Ok(path) = std::env::var("PR0_RESIDENT_SAVE_CONTROL") else {
        return;
    };
    loop {
        let control = std::fs::read_to_string(&path).unwrap_or_default();
        if control != "wait" {
            crate::library_storage::set_test_fault(&control);
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[test]
fn quit_waits_for_a_local_save_and_requires_an_explicit_decision() {
    let resident = Resident::default();
    resident.begin_save().unwrap();
    resident.action(ResidentAction::Quit).unwrap();
    assert_eq!(resident.finish_quit(), Err("save_in_progress".into()));
    resident.end_save();
    resident.action(ResidentAction::CancelQuit).unwrap();
    assert_eq!(resident.finish_quit(), Err("quit_not_requested".into()));
    resident.action(ResidentAction::Quit).unwrap();
    assert!(resident.finish_quit().is_ok());
    assert_eq!(resident.begin_save(), Err("quitting".into()));
}

#[cfg(windows)]
#[test]
fn activation_during_startup_has_one_owner_and_is_retained_until_ready() {
    use crate::resident_instance::Instance;
    let directory = std::env::temp_dir().join(format!("pr0-owner-{}", uuid::Uuid::new_v4()));
    let owner = Instance::acquire(&directory, false).unwrap().unwrap();
    // The owner has not created a window or started an activation listener yet.
    assert!(Instance::acquire(&directory, false).unwrap().is_none());
    assert!(!owner.wait_for_activation(0));
    assert!(Instance::acquire(&directory, true).unwrap().is_none());
    assert!(Instance::acquire(&directory, false).unwrap().is_none());
    assert!(owner.wait_for_activation(0));
    assert!(!owner.wait_for_activation(0));
    drop(owner);
    assert!(Instance::acquire(&directory, true).unwrap().is_some());
    std::fs::remove_dir_all(directory).unwrap();
}
