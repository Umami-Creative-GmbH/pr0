# Resident desktop — issue #54

The library now closes to the notification area without destroying its WebView or editor. First close presents the residency explanation and actual shortcut status before hiding; Settings retains that guidance. Native tray actions open the library, quick launcher, Settings, and the safe-quit flow. Window minimization is unchanged. Explicit activation makes one foreground request; Windows switching and notification-area routes remain the recovery paths.

The resident writer is acquired before Tauri initializes windows, credentials, shortcut registration, or background workers. A Windows file lock in the user's application-data directory excludes another writer, including another session of the same user. A user-scoped global event retains activation while the first process is still starting. This replaces the installed single-instance plugin, whose Windows implementation could continue startup when the mutex existed but its message window did not yet exist. Neither a second writer nor an external helper is launched.

Quit requests are retained in native status, so renderer subscription timing cannot lose them. The renderer resolves the actual editor save promise; the native exit command independently rejects an in-progress local save. Failed saves retain the draft and Retry/Copy text. Acknowledged local work exits without waiting for network delivery, keeping existing SQLite receipts and pending operations for restart. Quit releases shortcut/tray ownership and exits the process, including its network workers. New commands are main-window-only and have shared Zod request/status schemas. No REST/OpenAPI operation or library storage migration is introduced.

## Automated evidence

Validated on Windows with Bun 1.4.2, Rust 1.98.1, WebView2 and production Vite assets on 2026-09-21:

- Full native suite: 146 tests passed, including existing offline durability, interrupted uploads, restart, shortcut collisions and focus-refusal cases.
- Resident and launcher WebView2 suites: 8 tests, 24 assertions passed. These exercise real production capabilities and command handlers, not a renderer IPC replacement.
- Resident scenarios: Cancel retains the draft; Save and quit persists offline and reopens; an in-progress native save blocks exit until acknowledgement; full-disk failure retains all 256 KiB of draft content and retries; first-close explanation/hide; four concurrent manual activations reuse the existing draft; explicit discard exits.
- Full root Bun suite passed. Desktop and shared-contract typechecking passed. Ultracite passed after extracting the editor's field presentation.
- [Quit dialog captured during the native hide/restore test](../evidence/issue-54-resident-quit.png).

Storage failure and delayed commit are injected only in the Rust test build at the existing storage boundary. The same production command and SQLite transaction then run. Isolated fixture account approval supplies library data; no real account is used by these tests.

## Installed checks and remaining evidence

An isolated NSIS debug bundle (`pr0 Resident Validation`, identifier `com.umami-creative.pr0.validation54`, version `0.1.54`) built and installed successfully into the checkout's ignored `.scratch/installed-resident` directory. Its native library opened with the registered shortcut and accessible Settings/Quit controls. It uses a separate application-data directory from normal pr0.

The installed notification-area keyboard/overflow journey, ordinary installed restart, and native tray actions have **not yet been certified**. Computer Use was stopped with the physical Escape key; automatic approval review rejected its resumption even after the user asked to continue. Do not treat the automated native/WebView tests as completion of these installed checks. Full release signing, secure/elevated surfaces and the broader startup/resource matrix are not claimed by this slice.

## Reproduction

```powershell
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run test
$env:VITE_API_BASE_URL = 'https://instance.example'
bun run --cwd apps/desktop build
cargo test --lib --features search-webview-test --no-run --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
$nativeTest = Get-ChildItem apps/desktop/src-tauri/target/debug/deps/pr0_desktop_lib-*.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
mt.exe -manifest apps/web/tests/webview.manifest "-outputresource:$($nativeTest.FullName);#1"
& $nativeTest.FullName --test-threads=1
bun test apps/web/tests/desktop-resident.test.ts apps/web/tests/desktop-launcher.test.ts
```

Embed the manifest **before running each rebuilt native test executable**. Without it, Windows can show a `TaskDialogIndirect` entry-point error. Run Windows integration suites sequentially because they use the shared clipboard and global shortcuts.
