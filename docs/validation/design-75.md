# Accepted design port — issue #75

Status: production design port implemented locally; automated checks and visual evidence recorded below. Human visual approval and the deferred Windows checks remain pending. This is not release sign-off.

## Reference and destination map (recorded before UI changes)

Reference commit: `ae390cd8d2dd67b3ec6f9eb999a0f8e170cb9a57`, `packages/prototype-library`. Its source is unchanged. Captures use English controls and the original German fixture content.

| Surface | Accepted reference | Production destination | Boundary retained |
| --- | --- | --- | --- |
| Browser library | [Web dark](../evidence/design-75/reference-web-dark-detail.png), [web light](../evidence/design-75/reference-web-light-detail.png), matching `editor` and `empty` captures | `apps/web/src/app/account-screen.tsx`, `prompt-library.tsx` and their controls | Authenticated REST client, server acknowledgements, account partition and draft retention |
| Desktop main window | [Desktop dark](../evidence/design-75/reference-desktop-dark-detail.png), [desktop light](../evidence/design-75/reference-desktop-light-detail.png), matching `editor` and `empty` captures | `apps/desktop/src/app.tsx`, `downloaded-library.tsx`, search/detail/editor controls | Native SQLite commands, offline writes, actual download/upload/recovery and account state |
| Dedicated native launcher | [Standalone dark](../evidence/design-75/reference-native-launcher-dark-results.png), [standalone light](../evidence/design-75/reference-native-launcher-light-results.png), matching `empty`, `copy-error`, `variables` captures | `apps/desktop/src/launcher.tsx` | Existing native window/search/copy engine and actual shortcut/focus state |
| Browser quick access | [Web overlay dark](../evidence/design-75/reference-web-overlay-dark-results.png), [web overlay light](../evidence/design-75/reference-web-overlay-light-results.png), matching `empty` captures | Browser-only overlay inside the production library | REST results and browser clipboard; no native capabilities |

Library captures use a 1440×1000 viewport and preserve the prototype mode selector as provenance. Standalone launcher captures use 660×580 and render the exact accepted `LauncherPanel` with `standalone=true` in an ignored local reference harness. They show the accepted panel in a browser renderer, not a native-window validation. The prototype's simulated clipboard error is solely reference evidence.

## Implementation constraints

Shared presentation and locally bundled fonts belong in `packages/ui`. Production must not import the prototype runtime, fixtures or store. Keep the prototype route available. Preserve complete result navigation rather than its seven-result prototype cap.

Remove decorative traffic lights, fake identity/sync badges and simulated native shortcuts. Retain the real OS title bar on desktop. Show actual account, network, save and recovery states. Browser quick access and the dedicated native launcher are separate surfaces.

Issues #51 and #53 are closed. PR #85 (`c0607fe`) was merged into this branch after refreshing the remote on September 21. Its native template validation and variable-copy flow are retained; the design styles that implementation. The earlier prerequisite assessment used a stale local main revision.

## Production implementation

The web library, native library, browser quick access and dedicated native launcher use shared colors, bundled Outfit/Manrope/JetBrains Mono fonts, theme persistence, compact sidebar controls, icon actions, content panels and modal editors from `packages/ui`. Production imports no prototype runtime or seed store. Native variable behavior comes from merged #53.

Editors retain their mounted draft while **Browse library (keep draft)** or **Open original** exposes saved content; **Resume prompt draft** restores editing. Browser quick access has independent query/filter state, full result pagination, keyboard copy and Ctrl/Cmd+Enter opening. Slash focuses the main search, including when organization searches are collapsed.

Integration uncovered and fixed sign-out rejecting #54's residency files. Cleanup now preserves only the two expected regular metadata files; unknown paths still require review. The native regression confirms signing out retains single-process ownership.

## Deliberate differences from the prototype

- Real account identity, sync/download failures, pending changes and capacity remain visible. There is no fake synced badge, traffic-light decoration, prototype stage selector or simulated global shortcut in production.
- Large organization lists retain search, unavailable selections and management controls. The extra collection filter is expandable; these controls exceed the prototype's seeded chip-only behavior.
- Content remains a selectable read-only text field showing the exact stored template, including typed placeholders. The prototype's decorative token highlighting is not reproduced in that field.
- Browser and native variable forms retain required-field validation, typed number input, frozen templates, changed-template recovery, bounded output and failure retention. Their explanatory text and larger multiline fields take more room than the prototype.
- Native launcher's window, shortcut and focus policy remain owned by #51/#53. The browser overlay additionally implements the prototype's open-in-library shortcut; no new native command was invented to imitate it.
- Production save failures have no equivalent prototype storage/server failure. The error captures below show actual REST quota refusal and an actual SQLite disk-full fault in the test host, not a shipped simulated-error control.

## Side-by-side detail views

| Surface/theme | Accepted prototype | Production |
| --- | --- | --- |
| web / dark | ![Reference](../evidence/design-75/reference-web-dark-detail.png) | ![Production](../evidence/design-75/production-web-dark-detail.png) |
| web / light | ![Reference](../evidence/design-75/reference-web-light-detail.png) | ![Production](../evidence/design-75/production-web-light-detail.png) |
| desktop / dark | ![Reference](../evidence/design-75/reference-desktop-dark-detail.png) | ![Production](../evidence/design-75/production-desktop-dark-detail.png) |
| desktop / light | ![Reference](../evidence/design-75/reference-desktop-light-detail.png) | ![Production](../evidence/design-75/production-desktop-light-detail.png) |

## State comparison matrix

Each cell links reference → production at the same viewport and theme. Main libraries use 1440×1000; the native launcher uses 660×580. Native captures are WebView client areas, not evidence of OS chrome, tray behavior or manual foreground switching. Fixture content differs because production uses real isolated REST/SQLite records.

| Surface / state | Dark | Light |
| --- | --- | --- |
| web / editor | [Reference](../evidence/design-75/reference-web-dark-editor.png) → [Production](../evidence/design-75/production-web-dark-editor.png) | [Reference](../evidence/design-75/reference-web-light-editor.png) → [Production](../evidence/design-75/production-web-light-editor.png) |
| web / empty | [Reference](../evidence/design-75/reference-web-dark-empty.png) → [Production](../evidence/design-75/production-web-dark-empty.png) | [Reference](../evidence/design-75/reference-web-light-empty.png) → [Production](../evidence/design-75/production-web-light-empty.png) |
| desktop / editor | [Reference](../evidence/design-75/reference-desktop-dark-editor.png) → [Production](../evidence/design-75/production-desktop-dark-editor.png) | [Reference](../evidence/design-75/reference-desktop-light-editor.png) → [Production](../evidence/design-75/production-desktop-light-editor.png) |
| desktop / empty | [Reference](../evidence/design-75/reference-desktop-dark-empty.png) → [Production](../evidence/design-75/production-desktop-dark-empty.png) | [Reference](../evidence/design-75/reference-desktop-light-empty.png) → [Production](../evidence/design-75/production-desktop-light-empty.png) |
| web-overlay / results | [Reference](../evidence/design-75/reference-web-overlay-dark-results.png) → [Production](../evidence/design-75/production-web-overlay-dark-results.png) | [Reference](../evidence/design-75/reference-web-overlay-light-results.png) → [Production](../evidence/design-75/production-web-overlay-light-results.png) |
| web-overlay / empty | [Reference](../evidence/design-75/reference-web-overlay-dark-empty.png) → [Production](../evidence/design-75/production-web-overlay-dark-empty.png) | [Reference](../evidence/design-75/reference-web-overlay-light-empty.png) → [Production](../evidence/design-75/production-web-overlay-light-empty.png) |
| web-overlay / copy-error | [Reference](../evidence/design-75/reference-web-overlay-dark-copy-error.png) → [Production](../evidence/design-75/production-web-overlay-dark-copy-error.png) | [Reference](../evidence/design-75/reference-web-overlay-light-copy-error.png) → [Production](../evidence/design-75/production-web-overlay-light-copy-error.png) |
| web-overlay / variables | [Reference](../evidence/design-75/reference-web-overlay-dark-variables.png) → [Production](../evidence/design-75/production-web-overlay-dark-variables.png) | [Reference](../evidence/design-75/reference-web-overlay-light-variables.png) → [Production](../evidence/design-75/production-web-overlay-light-variables.png) |
| native-launcher / results | [Reference](../evidence/design-75/reference-native-launcher-dark-results.png) → [Production](../evidence/design-75/production-native-launcher-dark-results.png) | [Reference](../evidence/design-75/reference-native-launcher-light-results.png) → [Production](../evidence/design-75/production-native-launcher-light-results.png) |
| native-launcher / empty | [Reference](../evidence/design-75/reference-native-launcher-dark-empty.png) → [Production](../evidence/design-75/production-native-launcher-dark-empty.png) | [Reference](../evidence/design-75/reference-native-launcher-light-empty.png) → [Production](../evidence/design-75/production-native-launcher-light-empty.png) |
| native-launcher / copy-error | [Reference](../evidence/design-75/reference-native-launcher-dark-copy-error.png) → [Production](../evidence/design-75/production-native-launcher-dark-copy-error.png) | [Reference](../evidence/design-75/reference-native-launcher-light-copy-error.png) → [Production](../evidence/design-75/production-native-launcher-light-copy-error.png) |
| native-launcher / variables | [Reference](../evidence/design-75/reference-native-launcher-dark-variables.png) → [Production](../evidence/design-75/production-native-launcher-dark-variables.png) | [Reference](../evidence/design-75/reference-native-launcher-light-variables.png) → [Production](../evidence/design-75/production-native-launcher-light-variables.png) |

Production-only save errors: [web dark](../evidence/design-75/production-web-dark-error.png), [web light](../evidence/design-75/production-web-light-error.png), [desktop dark](../evidence/design-75/production-desktop-dark-error.png), [desktop light](../evidence/design-75/production-desktop-light-error.png).

## Automated checks (September 21, 2026)

- `bun run typecheck` and `bun x --bun ultracite fix`: pass.
- Web production build and desktop Vite build: pass; all three font families are bundled for offline use. Web build retains the existing dynamic search-directory tracing warning.
- `bun run test`: all eight workspace tasks pass (five valid cache hits after the merge).
- Native Rust suite: **153 passed**, including sign-out with resident ownership, variable conformance, clipboard behavior and offline storage/restart.
- Browser design/search/variables: **14 passed**, covering REST save/reload, both themes, quick-access failures and variables, keyboard navigation, full results, account changes and a 390px viewport.
- Browser retained/conflict drafts: **2 passed**, including Open original, browsing saved content while retaining successor text, and retry/copy after quota refusal.
- Native launcher: **4 passed**, including one/four competing shortcuts, manual recovery, offline copy and residency close behavior.
- Native variables: both tests passed in focused runs, including clipboard failure, back/query preservation, sign-out clearing, maximum output and 1,000 fields. Timing from #53 is not re-certified as a release percentile.
- Native design journey: **1 passed**, covering modal draft retention, offline save/restart, persisted theme, dedicated launcher, empty results, variable fields and SQLite disk-full retention. Run foreground-sensitive native journeys alone; launching other shell processes can cause the launcher to hide under its normal blur policy.
- Resident lifecycle: **4 passed** through the modal browse/resume path, including save-before-quit, cancellation, failed save and repeated activation.
- Independent Standards review: no hard violations. Spec follow-up review: no remaining concrete findings in the addressed editor, keyboard and merge changes.

The WebView test executable needs `apps/web/tests/webview.manifest` embedded with the Windows SDK manifest tool after rebuilding. Browser runs use `PR0_BROWSER_CHANNEL=msedge` on this machine. The integration server and credentials are isolated test fixtures.

## Remaining human validation

Review the paired screenshots against the accepted design in the actual app. Verify Windows OS titlebar, tray, native shortcut/focus behavior and the remaining #54 matrix in a normal desktop session. User explicitly deferred those checks until after this port. No issue closure, installer validation or final visual-parity approval is claimed here.
