# Windows launcher, search, and persistence capabilities

Research for [wayfinder issue #3](https://github.com/Umami-Creative-GmbH/pr0/issues/3), supporting [MVP map #1](https://github.com/Umami-Creative-GmbH/pr0/issues/1). Investigated 2026-09-19. This report records capabilities and unresolved choices; it does not select product policies or claim a working Windows prototype.

## Conclusion and fixed boundaries

Tauri 2 supplies the native primitives needed for the Windows MVP: global shortcuts, window visibility/focus, clipboard writes, local SQLite access, and installed URL handlers. They are components to integrate, not a complete launcher, sync engine, or authentication flow. Windows focus reliability, crash-safe offline writes, and installed upgrade behavior still need direct validation.

The inspected baseline is commit `4eae17845aa36453c5283b9c1b24681e928602a3`. [Architecture conventions](../architecture.md) fix the Vite/React desktop, Rust native core, hosted Next.js REST backend, and Bun-only JavaScript tooling. Bun is not embedded into the desktop runtime. Native integration stays in `apps/desktop`; shared UI does not import native modules. At this baseline, `apps/desktop/src-tauri/Cargo.toml` has Tauri but no feature plugins, `src/lib.rs` only starts the builder, and `capabilities/default.json` grants no permissions. The configuration uses identifier `com.umami-creative.pr0`. None of the capabilities below is already implemented.

## Launcher: documented building blocks

| Concern | Evidence | Consequence for the specification |
| --- | --- | --- |
| Global shortcut | The official plugin supports Windows and Rust/JavaScript registration, unregistering, and pressed/released events. [Guide](https://v2.tauri.app/plugin/global-shortcut/) | Define the trigger and prevent duplicate activation across key-down/up or repeat. |
| Shortcut conflicts | The reference warns that another application's occupied shortcut will not trigger this handler. `isRegistered` checks registration by this application, not a universal reservation guarantee. [API](https://tauri.app/reference/javascript/global-shortcut/) | A chosen default needs conflict reporting, rebinding behavior, and an alternative entry point. |
| Show, focus, hide | `show`, `hide`, `unminimize`, `setFocus`, focus events, and cancellable close requests are available. Focus calls return promises; listener cleanup is required. [Window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/) | Hiding, closing, quitting, and minimizing must have distinct specified outcomes. A hidden launcher can retain its window; closing it requires recreation or interception. |
| Foreground restrictions | Windows can refuse foreground activation even under documented eligibility conditions. [Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow) | Tauri's focus API is not evidence that focus always succeeds from every foreground application. Test actual activation. |
| Text copy | `writeText` returns a promise reporting success/failure. [Clipboard API](https://v2.tauri.app/reference/javascript/clipboard-manager/) | Await successful copy before claiming success or dismissing; define visible failure/retry behavior. Copy does not prove a paste occurred. |
| Background entry point | Tauri supplies tray icons and menus. [Tray guide](https://v2.tauri.app/learn/system-tray/) | A tray entry is an available fallback, not a policy selected by this research. Decide when the application remains running and how the user quits. |

Keyboard result navigation, Enter/Escape behavior, DOM input focus, selection state, empty results, and accessible announcements remain React/UI responsibilities. This is an architectural inference: the native APIs above deliver activation, window, and clipboard operations, not a prompt-selection interface. A global shortcut only works while its registering process is running; autostart and close-to-background behavior therefore need an explicit product decision.

## Local storage and search options

The official SQL plugin has a Windows-supported SQLite driver enabled by a Cargo feature. It accepts bound query parameters and supports versioned Rust-defined migrations, applied during preload/load. Its default permission grants load/select/close, with execute separately enabled. The guide documents transactional migration execution. This supports durable local records and evolving schemas, but does not provide synchronization, an outbox, conflict resolution, or application-level write transactions automatically. [SQL guide](https://v2.tauri.app/plugin/sql/)

A sharp implementation constraint: the current plugin command surface exposes individual load/close/execute/select calls, while its SQLite wrapper executes queries through a pool. There is no transaction handle in that guest command surface. Therefore separate JavaScript `BEGIN`, edit, outbox insert, and `COMMIT` calls must not be assumed to share a connection. A storage choice must prove atomic prompt-plus-pending-operation persistence, potentially through a bounded Rust command that owns one transaction. This is an inference from the inspected [commands](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/src/commands.rs) and [pool implementation](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/sql/src/wrapper.rs); pin and recheck the selected plugin release before implementation.

SQLite FTS5 provides token/prefix queries, ranking, Unicode tokenization, and an optional trigram tokenizer for substring-style matching. These are different search semantics; neither makes arbitrary typo-tolerant matching automatic. External-content indexes require correct index maintenance. Confirm FTS5 availability in the exact shipped SQLite build, then test the chosen behavior with punctuation, accents, tags, archive filtering, and edits. [SQLite FTS5](https://www.sqlite.org/fts5.html)

Alternative: Tauri Store persists key/value data, supports explicit saving, and otherwise uses debounced autosave or graceful-exit saving. It is a candidate for small preferences. Its documented behavior is not proof that a just-edited prompt survives a crash before the save, nor does it supply relational indexing or an outbox transaction. [Store guide](https://v2.tauri.app/plugin/store/)

An in-memory index rebuilt from durable records is also an architectural option. It would require representative size/startup benchmarks and consistent semantics across desktop and web; this report does not pick an engine or assume a maximum library size.

## Persistence, isolation, and credentials

The SQL implementation resolves relative SQLite filenames under `app_config_dir`. Tauri app paths incorporate the bundle identifier. Keeping that identifier and data location stable is consequently part of an upgrade contract. Account and backend identity must additionally partition data: the Tauri application directory alone does not distinguish users or hosted versus self-hosted libraries. [SQL source](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/sql/src/wrapper.rs), [path API](https://v2.tauri.app/reference/javascript/api/namespacepath/)

Inference: storing data outside the installed application files makes persistence across launches possible, but no inspected document establishes pr0's end-to-end migration, rollback, uninstall, or crash guarantees. Define acknowledgment only after durable local persistence; validate restart with pending work, interrupted migrations, full disk, and preservation of unsynced edits during upgrades. Specify sign-out/cache retention independently from server session revocation.

Stronghold is an official secret store with password-derived unlocking and explicit snapshot saving. It does not answer where a social-login user gets an unlock secret or how unattended restart obtains it. Hardcoding the example password would not resolve that design problem. [Stronghold guide](https://v2.tauri.app/plugin/stronghold/)

Windows alternatives include user-bound DPAPI, which normally ties decryption to the same Windows logon and machine; the machine-wide flag permits other users on that machine to decrypt. [Microsoft DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata) A maintained Rust Windows Credential Manager adapter also exists, with explicit persistence modes and documented concurrent-access caveats. It is a third-party Rust integration, not a built-in Tauri guarantee. [Adapter documentation](https://docs.rs/windows-native-keyring-store/latest/windows_native_keyring_store/)

The account/architecture decisions must choose credential storage and exposure: whether Rust alone uses the token for REST requests or a narrowly authorized command returns it to the frontend. Native at-rest storage does not protect a token after returning it to compromised frontend code. Namespace credentials by backend and account; validate sign-out deletion, reauthentication, store failures, and unavailable credentials separately from offline prompt access. Provider client secrets and hosted database credentials remain server-only under the repository's existing architecture.

Capabilities authorize native commands for specific windows/webviews; remote content gets no native API access by default. They do not sandbox malicious Rust or repair overly broad custom commands. Give the launcher only the commands it needs and keep external login in the browser. [Capabilities](https://v2.tauri.app/security/capabilities/) For text copy, `clipboard-manager:allow-write-text` suffices; clipboard reading is separately authorized and not required merely to copy a prompt. [Clipboard permissions](https://v2.tauri.app/plugin/clipboard/)

## Authentication callback and distribution constraints

Windows deep links arrive as command-line arguments to a new process. The single-instance plugin's `deep-link` feature forwards them to a running instance; register that plugin first. Static schemes are normally registered by installation; development can register them explicitly. Runtime-defined schemes require manual argument checks, and a caller can forge a link. Thus validate callbacks as untrusted inputs and test both cold-start and already-running delivery. Registration alone cannot authenticate a session handoff. [Deep-link guide](https://v2.tauri.app/plugin/deep-linking/)

This evidence was shared with the Better Auth researcher. The account-access decision must choose browser-to-desktop completion; a device-authorization design may avoid custom callbacks entirely. This report does not claim that Better Auth supplies a Tauri adapter or choose its token protocol.

Tauri produces NSIS setup executables or WiX MSI packages. MSI builds require Windows; Windows build targets use MSVC. The default installer may download WebView2 if missing; embedding an offline installer increases package size. Therefore offline application use and offline first installation are separate requirements. [Windows installer guide](https://v2.tauri.app/distribute/windows-installer/)

Windows code signing and updater signing are separate concerns. Windows can execute unsigned applications, but downloaded releases may encounter trust warnings; newly signed releases can also lack SmartScreen reputation. [Windows signing](https://v2.tauri.app/distribute/sign/windows/) Tauri's updater requires signed artifacts, an embedded verification key, and an update endpoint/manifest. Signature checks cannot be disabled; release-key custody and recovery matter. [Updater guide](https://v2.tauri.app/plugin/updater/) Self-hosting a server does not by itself establish who builds, signs, or updates the desktop client.

## Remaining validation questions for the map

These belong in the existing decision tickets, followed by implementation acceptance checks:

- **Launcher UX:** Which shortcut, conflict fallback, monitor placement, dismissal behavior, and process lifetime? Can the installed app focus the search input from a browser/editor, a minimized/hidden state, repeated triggers, mixed-DPI monitors, and a competing shortcut? Does copy failure retain a usable launcher?
- **Search and architecture:** Which matching/ranking semantics and representative library size? Does the shipped build support the selected index? Can an abrupt process stop between edit and queue persistence lose either half? Do restart, index rebuild, migration failure, and upgrade preserve every acknowledged offline edit?
- **Account access:** Which unlock/storage mechanism and token exposure boundary? What happens offline after expiry, sign-out, account switching, or backend switching? Are callback rejection and cold/running-instance delivery tested if callbacks are selected?
- **Release:** Which Windows versions/architectures, installer format, install scope, WebView2 mode, signing owner, and manual/automatic update policy? Does a real installed upgrade preserve data and pending work? Are changed identifiers, downgrade incompatibility, and uninstall data retention explicitly addressed?

No Windows prototype, installer build, plugin integration, or migration was run for this research. External sources describe their current documentation/source; pin exact dependency versions and verify these boundaries during implementation.
