# Web accessibility — issue #63

## Scope and evidence limits

On September 22, 2026 the owner narrowed this task to the installed Edge browser: “i only got edge, skip the rest, i dont care about them for now”. Chrome, Firefox, Safari and previous-major browser coverage are deferred. This record does not certify the original cross-browser release matrix or WCAG 2.2 AA conformance.

Manual screen-reader testing has not been performed. Keyboard automation, accessible-name/error associations and screenshots do not establish spoken announcements, reading order or freedom from background chatter. The dark-theme variable-token contrast exception accepted in #89 remains in effect (see [design evidence](design-75.md)).

## Change and regression

Pressing Escape while a prompt draft was dirty revealed a discard confirmation but left focus in the content field. The new served-browser regression reproduced that failure before the fix. The confirmation now focuses **Keep editing**, describes that action with the loss warning, and returns focus to the title when chosen. Discard returns focus to the original Create prompt button. No draft or persistence semantics changed.

The retained test traverses forward and backward through the native modal, prohibits focus on background controls, verifies the title's linked validation error, and verifies draft retention and focus return. Native dialog traversal can move to browser chrome (represented by the document body); that is permitted, while the next Tab must return to the modal.

A second journey recovers a verified account through the controlled mail sink, exercises mismatched passwords, resets the password, signs in, opens account settings and revokes another real session. It checks error/status focus and 320px document reflow. Field entry uses accessible labels; action activation uses the keyboard. It is not a claim of an entirely unassisted Tab-only journey.

Account-deletion journeys now follow the production Account settings disclosure, wait for requests excluding the live-change long poll, wait for asynchronous cancellation focus return, and browse/resume retained modal drafts. The public deletion and account-isolation assertions remain in place.

## Reproduction

From the repository root, using Bun 1.4.2 and Docker:

```powershell
$env:PR0_BROWSER_CHANNEL = 'msedge'
bun run --cwd apps/web test:accessibility
bun run --cwd apps/web test:account-deletion --browser-only
bun run typecheck
bun run test
bun x --bun ultracite check
```

Run the two browser commands sequentially: both build the same web output. Each starts and cleans its own isolated test Compose project; do not run alongside another test using the same fixture ports. Email/provider fixtures are controlled, while the served production application, REST routes, database and clipboard are real. Clipboard failure/delay scenarios inject only at the external clipboard boundary.

## Actual run — September 22, 2026

- Baseline: `ee0913d24565888d94295446611e96c15ce60548`.
- Installed Edge, headless: `153.0.4234.48` (reported by the launched browser).
- Windows build `26200.9457`, display version `25H2`, x64; Bun `1.4.2`; Next.js `16.3.5`.
- Final `test:accessibility`: **42 passed, 0 failed**, 252 assertions across 11 files (176.98 seconds). Covers keyboard editor errors/discard, recovery/login/settings, complete search/paging, collection/tag pickers at capacity, organization confirmations, archive/lifecycle, prompt deletion/preservation, conflict review and variable filling/copy including 100 fields at 200% CSS zoom.
- Final `test:account-deletion --browser-only`: **3 passed, 0 failed**. Signed receipt recovery, keyboard cancellation/completion and delayed old-receipt isolation all passed.
- `bun run typecheck`: 6 successful tasks, 5 cached. `bun run test`: 9 successful tasks, 8 cached. Repository-wide Ultracite check passed. The production build passed with the existing dynamic search-directory tracing warning.
- An earlier full accessibility run had **41 passed, 1 failed**: the tag-assignment journey timed out locating the renamed Ready checkbox after Edit tags. It passed in the earlier focused group and the final full run without a product change to tags. The intermittent cause is not established; the successful rerun does not prove it eliminated.
- Standards review: no remaining findings after strengthening the focus-return assertion. Spec review: no functional scope creep or incorrect discard behavior; manual assistive-technology evidence remains incomplete.

Retained artifacts: [actual journey results](../evidence/accessibility-63/results.json) and [Edge variable entry at 200% CSS zoom](../evidence/accessibility-63/edge-variables-200-percent.png). The screenshot was visually inspected for reachable fields and focused cancellation. Original prior-ticket screenshots are not replaced by this run.

## Remaining manual checks

With an actual screen reader and Edge, record reader/browser/OS versions and spoken outcomes for verified sign-in/recovery, search and later pages, editor validation and discard, and variable filling/copy success and failure. Check heading/landmark navigation, label/error association, dialog containment and return, and announcements during idle background synchronization. Also check real browser zoom, both themes, long text and touch-sized layouts; CSS zoom and viewport reflow tests are supporting evidence only.
