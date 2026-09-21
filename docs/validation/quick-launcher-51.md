# Windows quick launcher — issue #51

The production launcher reads the same Rust-owned offline library as the library window. Its native capability permits only launcher status, active search/cancellation, guarded copy and its own focus/hide operations. The library owns opening and shortcut retry. Renderer library mirroring, arbitrary event relay and renderer clipboard access have been removed, including their unused desktop dependencies. Native events invalidate views after committed changes; they do not carry library records.

Each opening resets query, filters and selection. Nonempty queries use shared relevance; empty queries use recently-used ordering. Collection, tag and favorite conditions are combined by the existing native search engine. Both result pages and every row are keyboard-accessible. Search cancellation is independent per window. Copy checks the active account, generation, opening and current archive state before the OS write, sharing the library's nonqueued clipboard admission. Clipboard success remains success if usage persistence or window hiding fails.

Shortcut candidates are attempted in the accepted order. Actual registration is displayed; all failures leave persistent unavailable status, Retry registration and manual entry. Focus observation controls readiness and blur dismissal. An initial refusal stays visible with Click to search and Alt+Tab/library recovery. Only observed focus enables normal blur dismissal; Escape and successful copy dismiss explicitly. Old copy completion cannot close a newer opening.

## Validation

Tests run on 2026-09-21 with Windows build 26200.9457 (25H2), WebView2 153.0.4234.48, Bun 1.4.2, debug native test binaries and production Vite assets.

Results: 116 native tests passed; all four WebView2/Windows integration tests passed (12 assertions). The root Bun suite passed (182 tests across its four test packages), as did workspace typechecking, Ultracite, the production desktop build and `git diff --check`. The final main-window lifecycle adjustment was verified by the dedicated real-WebView shutdown test after the complete native suite.

- Native command tests cover active-only search, eligibility recheck after incoming archival, failed clipboard writes, recent-use ordering, complete pagination, identity-based selection and independent cancellation. Existing shared ordering/filter fixtures also exercise the launcher. The existing concurrent-copy test now overlaps library and launcher operations and verifies that no second write is queued.
- Native lifecycle tests cover every prefix of colliding candidates, all unavailable, retry, initial focus refusal, acquired focus, subsequent blur and stale-opening completion.
- Real WebView2 tests use production assets, command handlers and capabilities over isolated persisted libraries. They exercise 55 local prompts, keyboard paging/selection/copy, query/filter reset, recency after copy, and denial of account/edit/general-search/relay/direct-clipboard commands.
- A competing Windows process holds shortcuts using RegisterHotKey. Tests exercise one and all four unavailable candidates, keyboard-accessible manual opening, release and explicit registration retry. Only registrations acquired by the helper are released; existing external owners remain untouched.
- A separate Windows process holds the clipboard through its own invisible window. The UI retains query, selected identity and error; releasing the clipboard permits an explicit retry that closes the launcher. [Captured failure state](../evidence/issue-51-launcher.png).
- The test worker also closes the main window normally and verifies the desktop exits. Until the separate tray/safe-quit slice implements residency, main-window destruction retains the previous app-exit behavior. A hidden companion cannot leave an inaccessible process holding a shortcut. This is not an implementation of close-to-tray or safe quit.

The fixture transport supplies initial account approval/download only; the UI does not replace native IPC. Test-only Windows helpers and the WebView worker do not ship in the production app. No REST endpoint, OpenAPI operation or persistence migration is introduced.

## Reproduction

From the repository root with Bun, Rust, the Windows SDK and WebView2 available:

```powershell
bun install --frozen-lockfile
bun run typecheck
bun run check
bun run test
$env:VITE_API_BASE_URL = 'https://instance.example'
bun run --cwd apps/desktop build
cargo test --lib --features search-webview-test --no-run --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
$nativeTest = Get-ChildItem apps/desktop/src-tauri/target/debug/deps/pr0_desktop_lib-*.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
mt.exe -manifest apps/web/tests/webview.manifest "-outputresource:$($nativeTest.FullName);#1"
& $nativeTest.FullName --test-threads=1
bun test apps/web/tests/desktop-launcher.test.ts
```

The manifest step is required for Rust's WebView-enabled test executable, as in the existing offline-search harness. Run the native suite and UI tests sequentially because both may use the Windows clipboard. The tests create isolated temporary account/WebView directories.

These checks are development evidence. Initial focus refusal is covered at the native lifecycle boundary; the signed installed application's elevated/secure-surface, screen-reader, mixed-monitor and full release-matrix checks remain separate. No tray, startup or resident-resource certification is claimed here.

## Review

Standards review: resolved the suppressed local-storage/status error; failures now retain shortcut/window state and show library recovery guidance. No outstanding findings.

Specification review: resolved missing native cancellation for obsolete launcher searches. Separate admission/cancellation preserves library-window searches. No outstanding findings.
