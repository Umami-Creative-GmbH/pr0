# Desktop process model, tray, and startup

Status: decision specification for [issue #19](https://github.com/Umami-Creative-GmbH/pr0/issues/19), accepted by the user in two live decision rounds on 2026-09-19. The user accepted all nine recommendations and subsequently reported successful validation, recorded below. The acceptance examples define required behavior; they do not themselves supply per-case test evidence.

## Authority and scope

The [Windows capability findings](https://github.com/Umami-Creative-GmbH/pr0/issues/3#issuecomment-5742306666) establish the available native primitives and Windows foreground restrictions. The [accepted interaction handoff](https://github.com/Umami-Creative-GmbH/pr0/issues/9#issuecomment-5743990156) supplies the library and quick-launcher direction. That general prototype walkthrough does not need repeating and does not establish an installed Windows focus or collision test matrix.

Preserve the [operating envelope](https://github.com/Umami-Creative-GmbH/pr0/issues/8#issuecomment-5742705995), [persistence and synchronization contract](persistence-sync-contract.md), and [save and synchronization presentation](save-sync-conflict-presentation.md). This document settles process lifetime, tray entry, startup, unavailable shortcuts, focus recovery, resource cost, and their release acceptance cases. Production implementation remains separate. No new glossary term or ADR is required.

## Process lifetime and entry points

Run one desktop application instance per Windows user. The resident application owns the global shortcut and tray entry. Do not introduce a separate helper or service to launch a fully quit application on a keystroke.

| Action or state | Required behavior |
| --- | --- |
| Open pr0 manually while it is not running | Start the application and show the library, or first-run setup when needed. Open compatible persisted local data without waiting for network synchronization. |
| Close the library window | Hide the library and leave the application, tray entry, and successfully registered global shortcut running. Preserve the current library and editor state, including any unsaved draft, in the running application. |
| Minimize the library | Use normal Windows minimization; keep the application and global shortcut running. |
| Open pr0 manually while it is already running | Deliver the activation to the existing application, restore/show the library, and request focus. Preserve its current state and draft. The second launch exits without a duplicate tray entry, shortcut owner, or independent data writer. |
| Quit pr0 | Follow the draft/save rules below, then exit the application, remove its tray entry, unregister its shortcut, and end background work. |
| Press the launcher shortcut while pr0 is fully quit | pr0 does nothing and does not start. It no longer owns the keystroke; Windows and other applications handle it normally, if applicable. Reopen pr0 through Windows to make its shortcut available again. |

Explain on the first library close: **pr0 is still running in the notification area. Use Quit pr0 to exit; its global shortcut stops working when you quit.** Make the explanation visible as part of that user action and keep the same information in Settings; do not rely on the user noticing a disappearing window or a notification toast. Show the actual registered shortcut, or its unavailable state, rather than promising a shortcut that failed registration.

An unsaved draft retained by hiding the window is still an in-memory draft, not a durable save. Do not claim it survives a crash, forced termination, or Windows restart. Already acknowledged local saves and their pending synchronization retain the existing durability guarantees.

## Tray and startup

Keep a tray icon for the lifetime of the running application, whether its windows are open or hidden. A click opens/restores the library. Its menu provides **Open library**, **Open quick launcher**, **Settings**, and **Quit pr0**. Both library and tray routes can open the quick launcher even when no global shortcut is registered. Settings and the library expose the shortcut status and relevant recovery actions.

Tray actions must be keyboard-accessible through the Windows notification area, including when Windows places the icon in its overflow area. Do not assume the user pins the icon. The tray represents a running application; no tray icon or pr0-owned shortcut remains after a completed quit.

**Start at login** is opt-in and off by default. Offer it once during first-run setup and keep the setting available afterwards. A first manual run opens setup visibly; later manual runs show the library. An enabled login launch starts quietly in the tray with no library or launcher window and no unsolicited authentication dialog. Sign-in requirements remain discoverable through the existing status surfaces when opened.

Quitting does not disable the next login's startup setting. Disabling Start at login prevents subsequent automatic launches but does not quit the current application. Display whether startup is actually enabled; a failed startup registration must not appear successful. If Windows disables the startup entry externally, do not silently re-enable it merely because pr0 opens manually. Startup and manual-launch races use the same single-instance rule; an explicit manual activation still shows the library.

## Shortcut registration and collision recovery

Try the accepted prototype's candidates in this order, stopping at the first successful registration:

1. `Ctrl+Shift+P`
2. `Alt+Space`
3. `Ctrl+Alt+P`
4. `Ctrl+Shift+Space`

Expose the shortcut actually registered in the library and Settings, and retain its display in the quick launcher. A failed candidate is not a successful registration. Do not replace another application's ownership or claim that a local registration query proves universal availability.

If every candidate fails, keep the application running and all manual entry points usable. Show persistent **Global shortcut unavailable** status and a **Retry registration** action. Retry attempts the same ordered candidates and updates the displayed result. Do not issue repeated alerts or continuously retry in the background. A custom shortcut editor is not required by this decision.

Only the resident application owns registration. A second launch must not start another candidate chain. Registration failure must not prevent library access, manual launcher opening, copying, Settings, or quitting.

## Foreground focus and launcher recovery

An explicit launcher activation shows/restores the launcher, requests foreground focus, and focuses its search input when activation succeeds. Windows can refuse foreground activation; a successful show request or a focus API call is not proof that typing will reach the launcher. Observe actual focus state.

If the launcher appears without focus, keep it visible with **Click to search**. Clicking it gives the user a direct activation path. Do not hide it merely because initial foreground activation failed. Enable normal dismissal on focus loss only after the launcher has actually acquired focus during that opening. Escape and the accepted successful-copy behavior still dismiss it; clipboard failure retains the query, selection, error, and retry path.

Provide a keyboard recovery route through the Windows notification area to **Open quick launcher**, and through **Open library** to the library's launcher action. Foreground refusal must not leave a mouse-only recovery path. Explicit library or second-instance activation also requests focus without repeatedly trying to seize it if Windows refuses; the visible library and Windows window-switching/notification-area routes remain available.

Do not use notification toasts or repeated foreground requests as focus recovery. The tray actions and visible launcher are the chosen fallback. Never bypass elevated or secure Windows surfaces; validate recovery after returning to the ordinary desktop. Background synchronization does not open windows or steal focus.

## Closing, quitting, and pending work

Closing the library retains an unsaved editor in the resident application and does not discard it. Opening the existing application again restores that state.

When Quit pr0 would discard unsaved changes, show **Save and quit**, **Discard and quit**, and **Cancel** with a clear explanation that discarding loses the unsaved draft:

- **Save and quit** exits only after the local save is durably committed. Keep the editor open while that result is unknown. On failure, retain the complete draft and existing Not saved, Retry, and Copy text recovery; do not quit as though saving succeeded.
- **Discard and quit** is the explicit confirmed choice to lose the unsaved draft. It does not discard earlier durable work or its pending synchronization.
- **Cancel** keeps the application and draft available.

A save already in progress cannot be treated as successful until its local result is known. The quit flow must resolve that result before deciding whether saving succeeded or a draft still needs the user's choice. Tray-initiated quit exposes the same editor/confirmation rather than hiding a blocking decision behind the tray.

Already durable work needs no quit confirmation and does not wait for server acknowledgement. Preserve its pending operations under the existing receipt and transaction rules and resume synchronization on the next launch. Quitting offline, during an upload, or with rejected pending work cannot silently discard that work or report it synchronized. This decision adds no promise of unsaved-draft recovery after forced termination and no arbitrary timeout that converts an unknown local save into success.

## Resource and responsiveness acceptance

Background residency has a release budget. On the agreed four-core Windows computer with 8 GiB RAM and SSD, use a fully downloaded and indexed maximum library of 10,000 prompts and 100 MiB of text. Record the concrete hardware, Windows build, WebView2 version, application build, and workload.

After the application has settled, close both library and launcher surfaces and measure a continuous ten-minute idle interval with no user operations, no pending backlog, and no incoming library changes. Leave ordinary background synchronization enabled; its normal checks count as idle work. Report the sum across the native application and attributable WebView2 processes, not only the Rust parent:

| Measure | Accepted target |
| --- | --- |
| Total private committed process memory during settled idle | At most 300 MiB across the application and attributable WebView2 process tree; report the peak over the interval. |
| Average CPU over the ten-minute idle interval | Less than 1% of total machine CPU capacity, aggregated across the same processes. |
| Warm quick launcher, ready to type | At least 95% of operations within 200 ms, under the existing benchmark conditions. |
| Manual cold start, ready to search existing local data | At least 95% of operations within 3 seconds, under the existing benchmark conditions. |

Use binary MiB. Record the process attribution and sampling method so measurements can be repeated. Foreground-refusal cases must be reported separately with their recovery result; showing an unfocused launcher cannot count as meeting ready-to-type latency. First-run download/indexing remains subject to its separate operating-envelope target, not the cold-start target for an existing local library.

Stop hidden UI animations and unnecessary rendering or polling. Keep synchronization active and preserve the existing five-second online cross-device target; reducing idle work must not suspend the agreed background synchronization behavior. Validate resource use after normal library and launcher use as well as a quiet login launch, so a cheap startup does not mask retained memory after interaction.

The persistence contract's 256 MiB aggregate desktop application-cache allowance covers SQLite caches, decoded postings, and metadata. It is a ceiling, not a required allocation, and is neither additional to the 300 MiB process budget nor a claim about total process memory. Runtime and WebView2 overhead must fit the process budget with the caches actually retained. Active indexing and backlog reconciliation are measured separately from settled idle and retain their existing bounded-work/performance requirements.

These are accepted release targets, not observed results. Failure requires implementation work or an explicit revision of the accepted targets; do not silently raise the budget or declare release compliance from prototype timings.

## Observable acceptance examples and installed release matrix

Use the signed per-user installed application on Windows 11 x64 across Microsoft-supported releases with current WebView2, recording actual versions and test evidence. Windows 10 and native ARM64 are outside the accepted first-release support matrix. Test the following cases before release; the required outcome, including usable recovery where Windows refuses focus, is the gate.

| Scenario | Required observable result |
| --- | --- |
| First manual run and first close | Setup opens visibly; Start at login is off unless chosen. Closing explains residency and how to quit, then leaves the tray and registered shortcut available. Reopening shows the existing library state. |
| Close with an unsaved draft | Close hides the library without claiming a durable save. Opening via tray or a second manual launch restores the draft and editor state. |
| Quit with an unsaved draft | Save and quit, Discard and quit, and Cancel produce their stated outcomes. A full-disk/save failure retains the draft and recovery controls and prevents a successful-save exit. |
| Quit with durable offline or uploading work | Quit finishes without waiting for server acknowledgement. The tray and shortcut disappear; the next launch retains local work and pending operations and safely resumes under the existing receipt rules. |
| Cold invocation | With pr0 fully quit and autostart disabled, the shortcut does not start pr0. A manual Windows launch opens it; an existing local library becomes search-ready within the cold-start target, including offline use. |
| Login startup and subsequent launches | Opted-in startup is quiet and registers the shortcut or records its unavailable state. Off means no automatic start. Quit preserves the setting; disabling it prevents the next login launch. Manual launch always shows the library. |
| Second instance and startup race | Repeated or simultaneous manual launches produce one resident application, one tray entry, one shortcut owner, and one data writer. Existing window/editor state survives. A manual launch racing with login startup still requests the library. |
| Individual shortcut collisions | Occupy earlier candidates in turn; pr0 registers the next available candidate and displays that exact shortcut. Other applications retain their registrations. |
| Every shortcut candidate occupied | Show Global shortcut unavailable. Tray and library launcher actions still work. Releasing a candidate and choosing Retry registration acquires the first available one and updates the display without restarting pr0. |
| Foreground activation from browsers and editors | Invocation normally focuses search and supports immediate typing, navigation, and copy. If focus is refused, the visible launcher stays open with Click to search and both pointer and keyboard recovery work. |
| Elevated foreground application or secure surface | No attempt to bypass Windows protections. Where activation is refused, recovery works on the ordinary desktop, without repeated focus requests or losing keystrokes into a falsely reported focused launcher. |
| Keyboard-only tray recovery, including overflow | Using the Windows notification area, reach every tray action and focus the library or launcher without a pointer. Copy success dismisses the launcher; copy failure retains usable error/retry state. |
| Minimize, restore, repeated activation, and focus loss | Minimize does not quit. Explicit activation restores the intended existing window. No duplicate launcher appears. Initial focus refusal does not hide it; losing focus after successful activation dismisses it normally. |
| Sleep/resume and changed monitor configuration | The resident application remains reachable; shortcut status remains truthful, with manual routes and retry available on failure. Library and launcher are usable after resume, on mixed-DPI monitors, and after disconnecting a monitor. |
| Installed update with pending edits | A user-approved update preserves the local library and pending work and returns to one usable application with working entry points. An unsaved draft is never silently discarded by the quit path. |
| Settled residency and timings | After login startup and after normal interaction, the process tree meets the idle memory/CPU budget and the existing warm/cold responsiveness targets on the recorded maximum-library fixture. Hidden UI work cannot consume the budget unnoticed. |

Core keyboard access, visible focus, accessible dialogs/errors, and manual screen-reader checks retain the operating envelope's accessibility requirements. Test startup registration failure and external Windows startup disablement as well as success; displayed startup state must match the actual outcome.

## Completion boundary

The live decisions for #19 are settled. No additional prototype was needed to judge them from description. The repository's in-memory prototype does not implement tray residency, autostart, single-instance coordination, durable quit handling, or the complete focus fallback specified here. This decision document does not change production code.

## Human validation report

On 2026-09-19, after approving the specification and receiving the validation checklist, the user reported: **“i validated it everything checked out”**. Record this as the user's successful validation report and acceptance of the desktop process-model outcome. No further repetition of the walkthrough is required to complete decision ticket #19.

The report did not identify the tested build, Windows/WebView2 versions, individual case results, or resource and timing measurements. Preserve the report as given without inventing that evidence or treating it as an agent-observed test run. The release matrix and measurement requirements above remain the record to satisfy for release; closing this decision ticket does not certify a particular production build.
