#[test]
fn launcher_defers_blur_and_navigation_during_write_without_refocusing_on_failure() {
    let launcher = crate::launcher_runtime::Launcher::default();
    let opening = launcher.open().unwrap();
    launcher.observe_focus(true).unwrap();
    launcher.begin_write(opening).unwrap();
    assert!(!launcher.observe_focus(false).unwrap());
    assert!(!launcher.hide(opening).unwrap());
    assert_eq!(launcher.open().unwrap(), opening);
    launcher.end_write(opening).unwrap();
    let status = launcher.status().unwrap();
    assert!(status.visible);
    assert!(!status.focused);
    assert!(launcher.hide(opening).unwrap());
}

#[test]
fn launcher_search_is_active_only_and_copy_rechecks_eligibility_offline() {
    let (directory, service, transport) = downloaded_change_fixture();
    let id = "66666666-6666-4666-8666-666666666666";
    let request = search_request(&service, "");
    let page = service.launcher_search(request.clone()).unwrap();
    assert!(page.prompts.iter().any(|p| p.id == id));
    let copy = copy_request(&service, id);
    assert_eq!(
        service
            .launcher_copy(copy.clone(), |_| Err("clipboard_unavailable".into()))
            .err()
            .as_deref(),
        Some("clipboard_unavailable")
    );
    let mut change = change_fixture();
    change["changes"][0]["prompts"][0]["archived"] = json!(true);
    transport.0.lock().unwrap().push(change);
    assert!(service.library_changes(0).unwrap().error.is_none());
    assert!(!service
        .launcher_search(request.clone())
        .unwrap()
        .prompts
        .iter()
        .any(|p| p.id == id));
    assert_eq!(
        service
            .launcher_copy(copy, |_| panic!("archived clipboard write"))
            .err()
            .as_deref(),
        Some("prompt_unavailable")
    );
    let mut forbidden = request;
    forbidden.view = "archive".into();
    assert_eq!(
        service.launcher_search(forbidden).err().as_deref(),
        Some("forbidden")
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn launcher_shortcut_collisions_and_observed_focus_have_recovery() {
    use crate::launcher_runtime::Launcher;
    for blocked in 0..=4 {
        let launcher = Launcher::default();
        let candidates = [
            "Ctrl+Shift+P",
            "Alt+Space",
            "Ctrl+Alt+P",
            "Ctrl+Shift+Space",
        ];
        launcher
            .register(|candidate| !candidates[..blocked].contains(&candidate))
            .unwrap();
        assert_eq!(
            launcher.status().unwrap().shortcut.as_deref(),
            candidates.get(blocked).copied()
        );
        let opening = launcher.open().unwrap();
        assert!(!launcher.observe_focus(false).unwrap());
        assert!(
            launcher.status().unwrap().visible,
            "initial refusal stays visible"
        );
        assert!(!launcher.observe_focus(true).unwrap());
        assert!(launcher.status().unwrap().focused);
        assert!(
            launcher.observe_focus(false).unwrap(),
            "blur dismisses only after acquisition"
        );
        let next = launcher.open().unwrap();
        assert!(next > opening);
        assert!(
            !launcher.hide(opening).unwrap(),
            "old copy completion cannot hide a new opening"
        );
        assert!(launcher.hide(next).unwrap());
        launcher.register(|_| true).unwrap();
        assert!(launcher.status().unwrap().shortcut.is_some());
    }
}

#[test]
fn launcher_pages_recent_use_and_preserves_selection_by_identity() {
    let directory =
        std::env::temp_dir().join(format!("pr0-launcher-order-{}", uuid::Uuid::new_v4()));
    let mut prompts = Vec::new();
    for index in 0..65 {
        let mut prompt = search_prompt(index);
        prompt["title"] = json!(format!("Prompt {index:02}"));
        prompt["content"] = json!("offline needle");
        prompt["favorite"] = json!(index % 2 == 0);
        prompts.push(prompt);
    }
    let service = search_download(&directory, search_snapshot(prompts, vec![], vec![]));
    let used = "00000000-0000-4000-8000-000000000060";
    service
        .launcher_copy(copy_request(&service, used), |text| {
            assert_eq!(text, "offline needle");
            Ok(())
        })
        .unwrap();
    let mut request = search_request(&service, "");
    let first = service.launcher_search(request.clone()).unwrap();
    assert_eq!(first.prompts[0].id, used);
    assert_eq!(first.prompts.len(), 50);
    request.cursor = first.next_cursor;
    let second = service.launcher_search(request.clone()).unwrap();
    assert_eq!(second.prompts.len(), 15);
    assert!(second.next_cursor.is_none());
    request.cursor = None;
    request.selected_id = Some(used.into());
    request.query = "needle".into();
    request.favorite = Some(true);
    assert_eq!(
        service
            .launcher_search(request.clone())
            .unwrap()
            .selected_id
            .as_deref(),
        Some(used)
    );
    request.query = "absent".into();
    assert!(service
        .launcher_search(request)
        .unwrap()
        .selected_id
        .is_none());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn launcher_search_does_not_cancel_library_search() {
    let (directory, service, _) = downloaded_change_fixture();
    let request = search_request(&service, "");
    let admitted = service.admit_search(&request.request_id).unwrap();
    let old = search_request(&service, "Second");
    let cancelled = service.admit_launcher_search(&old.request_id).unwrap();
    service
        .launcher_search(search_request(&service, "First"))
        .unwrap();
    assert_eq!(
        service
            .launcher_search_admitted(old, cancelled)
            .err()
            .as_deref(),
        Some("operation_cancelled")
    );
    assert!(!service
        .library_search_admitted(request, admitted)
        .unwrap()
        .prompts
        .is_empty());
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
// Opt-in competing Windows owner. Its registrations disappear when this test process exits.
#[cfg(windows)]
#[test]
fn launcher_collision_worker() {
    use std::io::{BufRead, Write};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_SHIFT,
    };
    let Ok(count) = std::env::var("PR0_LAUNCHER_COLLISIONS") else {
        return;
    };
    let count: usize = count.parse().unwrap();
    let candidates = [
        (MOD_CONTROL | MOD_SHIFT, 0x50),
        (MOD_ALT, 0x20),
        (MOD_CONTROL | MOD_ALT, 0x50),
        (MOD_CONTROL | MOD_SHIFT, 0x20),
    ];
    let mut owned = Vec::new();
    for (index, (modifiers, key)) in candidates.into_iter().take(count).enumerate() {
        // No HWND is supplied; the current thread owns only successfully registered IDs.
        if unsafe { RegisterHotKey(std::ptr::null_mut(), index as i32 + 1, modifiers, key) } != 0 {
            owned.push(index as i32 + 1);
        }
    }
    println!("READY:{}", owned.len());
    std::io::stdout().flush().unwrap();
    let _ = std::io::stdin().lock().lines().next();
    for id in owned {
        unsafe {
            UnregisterHotKey(std::ptr::null_mut(), id);
        }
    }
}

#[cfg(windows)]
#[test]
fn launcher_clipboard_worker() {
    use std::io::{BufRead, Write};
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, OpenClipboard};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, HWND_MESSAGE,
    };
    if std::env::var("PR0_HOLD_CLIPBOARD").as_deref() != Ok("true") {
        return;
    }
    // Hold the clipboard without clearing or reading it; release when the parent closes stdin.
    let window = unsafe {
        CreateWindowExW(
            0,
            windows_sys::w!("STATIC"),
            windows_sys::w!("pr0 test clipboard owner"),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        )
    };
    assert!(!window.is_null());
    assert_ne!(unsafe { OpenClipboard(window) }, 0);
    println!("READY:1");
    std::io::stdout().flush().unwrap();
    let _ = std::io::stdin().lock().lines().next();
    unsafe {
        CloseClipboard();
        DestroyWindow(window);
    }
}
