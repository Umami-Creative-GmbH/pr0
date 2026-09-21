# Accepted design port — issue #75

Status: reference inventory captured; production port in progress. This is not a validation sign-off.

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

Issue #51 is closed. Issue #53 remains open: native variable handling is an outstanding prerequisite, not behavior that may be replaced with prototype substitution logic. Reassess this dependency before claiming #75 complete.

## Validation still required

Production captures paired at matching viewport/theme and state, public-control persistence/copy/failure/theme journeys per surface, required builds/types/lint/tests, and final independent standards/spec reviews. No production visual parity or Windows human validation is claimed here. Remaining #54 validation is deferred at the user's request until after this design port.
