# Windows login startup — issue #55

## Implementation

Start at login is off by default. First-run UI offers Enable or Not now, with Done after enabling; dismissing the offer writes and synchronizes a device-local marker. Settings retains the control independently of account sign-in. Registration is per Windows user and contains the quoted current executable followed by `--startup`. No desired-state preference rewrites Windows registration during launch, sign-in, or quit.

The native status command reads the actual Run value and its StartupApproved state. Missing registration is Off, a matching approved registration is On, and a Windows-disabled entry has explicit Windows Settings recovery. Failed reads, unexpected commands and unknown approval encodings are unavailable, never On. Write failures remain errors after status refresh. Only an explicit enable/disable action writes the application's Run value. External disablement is never cleared by pr0, including on explicit enable; the user can re-enable it in Windows Settings. Disable removes registration without quitting, and quit does not touch registration.

Both native windows are created hidden, before any show request. A manual launch shows the library; `--startup` leaves both windows hidden. A secondary startup invocation exits without signaling activation. Manual activation uses the resident event even when it races startup, and startup cannot consume or cancel that pending manual request. Only the lock owner initializes workers, the tray, credentials and shortcut registration. The tray tooltip reports the actual shortcut or its unavailable state.

WebView2 was observed to report `document.visibilityState === "visible"` for a hidden native window. UI refreshes therefore use the authorized native `surface_visible` query and native visibility/focus/launcher events. Hidden library/auth/copy-observation invalidations are coalesced into a refresh on show; animations and shared minute presentation clocks are paused. Draft and in-flight save state stay mounted. Copy cancellation and native lifecycle events remain active. The Rust synchronization loops are unchanged and continue while hidden.

Startup commands are authorized only for trusted main-window content. Visibility is readable by both trusted native windows. Strict shared Zod schemas validate startup actions and returned states. No REST operation, OpenAPI change, account record or library migration is required for this device-local Windows setting.

## Automated evidence

On 2026-09-22:

- The new shared status conformance test passed after first failing on the absent schema.
- The first-run UI journey first failed on the missing offer, then passed against actual WebView2 and native commands.
- The quiet-launch journey first failed on the visible startup behavior; native window visibility and concurrent launch checks now pass.
- Four startup WebView2 journeys passed, with 12 assertions: default off, once-only dismissal across restart, enable/disable, quit preserving registration, external disablement across manual restart, unknown approval encoding, real registry access-denied error, quiet startup and racing manual activation.
- The nine resident/launcher regression journeys passed, preserving draft/save/quit behavior and shortcut recovery.
- After review fixes, all **14 native WebView2 journeys passed with 44 assertions**, including hidden relative-time clocks resuming after a launcher-to-library activation and startup mutation denial from the launcher.
- Workspace typechecking, Ultracite and the root Bun test suite passed.
- The full native suite passed: 161 tests, zero failures (299 seconds).

The startup test build uses real Windows registry APIs in a unique `HKCU\Software\pr0-startup-tests` subtree. Access-denied testing opens a read-only handle so the real Windows write fails. External changes are made outside the application before reading through the native command/UI. These tests deliberately do not install the test runner as a login application. They prove command behavior, not Windows executing an installed Run entry at login.

[Startup state screenshot](../evidence/issue-55-startup-state.png).

## Installed and resource gates remain open

This task has no supplied signed installed build, configured accepted four-core/8 GiB/SSD host, or fully synchronized 10,000-prompt/100 MiB installed library. An actual Windows logout/login was not performed. These acceptance criteria are **not certified**, and issue #55 must remain open until the missing evidence is supplied and verified. No signed release, ten-minute maximum-library pass, ordinary hidden sync measurement, or installed Windows Startup Settings journey is claimed from the small native fixture.

The [resource sampler](../../apps/desktop/scripts/measure-residency.ps1) records OS/hardware, executable/signature, attributable native and WebView2 process versions, per-process CPU/private committed bytes, interval samples and targets. It excludes its own process. Process turnover marks accounting incomplete. Short runs and runs without normal sync explicitly cannot meet the acceptance result.

The two `issue-55-*-smoke.json` evidence files are short debug-harness sampler checks, not ten-minute release measurements. Their metadata records the small offline fixture, absent normal sync workers, attached CDP and unsigned build. Use their actual process/version records only within those limits.

The recorded smoke measurement observed 234.29 MiB after quiet launch and **407.88 MiB after interaction**, with mean CPU 0.0046% and 0.0273% respectively over roughly 10.7 seconds. The interaction memory exceeds the 300 MiB target even with the small fixture: this is an unresolved resource concern, not a passing release measurement. Windows was 11 Business build 26200, WebView2 153.0.4234.48, on a Ryzen 9 9950X3D2 with 32 logical CPUs and approximately 96 GiB installed RAM. The final sampler files identify their exact executable hash and observed values; later smoke runs do not replace the required maximum-library interval.

## Standards

No findings. Native platform APIs remain outside shared UI, and shared contracts validate IPC payloads. The visibility provider and presentation clock preserve the workspace boundaries.

## Spec

Two findings corrected: shared minute presentation timers now stop using a platform-neutral active-presentation context, and launcher-to-library details uses the common visibility-emitting show path even if focus is refused. Both fixes were re-reviewed with no additional findings; the hidden-clock/restore UI regression passed. Native background synchronization and mounted draft/save state remain active. The installed and resource acceptance gaps above remain open.

Review totals: Standards 0 findings; Spec 0 remaining code findings (2 corrected), with installed/resource acceptance still incomplete.

## Reproduce automated checks

```powershell
bun install --frozen-lockfile
$env:VITE_API_BASE_URL = 'https://instance.example'
bun run --cwd apps/desktop build
cargo test --lib --features search-webview-test --no-run --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
$nativeTest = Get-ChildItem apps/desktop/src-tauri/target/debug/deps/pr0_desktop_lib-*.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
mt.exe -manifest apps/web/tests/webview.manifest "-outputresource:$($nativeTest.FullName);#1"
& $nativeTest.FullName --test-threads=1
bun test apps/web/tests/desktop-startup.test.ts apps/web/tests/desktop-resident.test.ts apps/web/tests/desktop-launcher.test.ts
bun run typecheck
bun run test
bun run check
```

Run native integration suites sequentially because they share Windows clipboard/shortcut resources. The WebView debugging connection may need execution outside a restricted sandbox. The production binary has no test registry path or failure controls.

## Installed journey and measurement procedure

1. Install the signed per-user build on the accepted Windows 11 x64 host and record its signature, application version and hash. On first manual launch, verify the visible offer and Off. Choose Not now, quit and reopen; the offer must stay dismissed and Settings must remain available.
2. Enable startup in Settings. Verify the matching per-user Run command, Windows Settings → Apps → Startup state, then quit and log out/in. Record one resident/tray/shortcut owner, neither window visible and no unsolicited browser/authentication dialog. Verify the actual shortcut status through the tray and Settings.
3. Open manually during startup and while resident; verify the existing library appears and a draft survives. Repeat with startup following a manual launch. Verify no duplicate writer/tray/shortcut owner.
4. Disable the entry externally in Windows Settings. Manually reopen pr0 and verify Disabled by Windows without registration repair. Exercise recovery by explicitly enabling in Windows Settings. Test registration denial on a disposable Windows profile/build and retain the visible error plus actual registry outcome.
5. Disable in pr0, verify the resident stays running, then quit and log out/in; pr0 must not start. Enable again, quit, and verify the next login still starts quietly.
6. Populate and fully synchronize/index the 10,000-prompt/100 MiB library. Leave normal sync enabled with no backlog/incoming edits. After quiet login has settled, run the sampler below against the native parent PID. Repeat after normal library/launcher use, closing both surfaces and settling again. Record stimulus/settle times and confirm unrelated processes are excluded.

```powershell
# Replace the PID and descriptions with the actual recorded build/workload.
./apps/desktop/scripts/measure-residency.ps1 -RootProcessId 1234 -Phase quiet-login -BuildDescription 'signed build and commit' -WorkloadDescription '10000 prompts, 104857600 text bytes, fully indexed, no backlog/incoming changes' -NormalSyncEnabled -OutputPath docs/evidence/issue-55-quiet-login.json
./apps/desktop/scripts/measure-residency.ps1 -RootProcessId 1234 -Phase after-interaction -BuildDescription 'same signed build and commit' -WorkloadDescription 'same maximum library after library and launcher use; both hidden, settled' -NormalSyncEnabled -OutputPath docs/evidence/issue-55-after-interaction.json
```

Keep the targets unchanged: at most **300 MiB** peak private committed memory across the whole attributed tree and **less than 1%** mean total-machine CPU for **ten continuous minutes**, with the aggregate 256 MiB application-cache allowance included. Validate ordinary hidden synchronization independently by changing a prompt from another device and checking the existing five-second visibility requirement; exclude that incoming-edit period from the settled measurement.

## Windows implementation references

- Microsoft's [Run and RunOnce documentation](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys) specifies per-user login execution and the Run command length limit.
- Electron's [Windows login implementation](https://github.com/electron/electron/blob/main/shell/browser/browser_win.cc) provides primary implementation precedent for checking StartupApproved separately from the Run entry. pr0 conservatively reports unknown encodings unavailable and does not write StartupApproved.
