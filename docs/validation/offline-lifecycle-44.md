# Offline prompt lifecycle — issue #44

Implemented on Windows with Bun 1.4.2 and Rust/Tauri. Native SQLite commands persist favorite, archive/restore, duplicate and confirmed permanent deletion, then deliver the established public REST operations.

## Behavior

- Projection, local revision, search changes, deletion visibility and outbox commit together. SQLite migration 6 preserves existing pending text/usage and prevents reuse of locally created identities.
- Active, Favorites, Archive and Recents respect archive eligibility. Archived records remain editable/copyable; duplication takes the selected snapshot, retains organization and full source title, and resets favorite/archive/usage with fresh dates.
- Metadata actions remain separate from text intent. Incoming changes retain pending metadata. Conflict acknowledgements retarget the complete successor chain while preserving later text and lifecycle actions.
- A stale delete's server conflict copy is downloaded from authoritative state; it is never fabricated from stale local text. Accepted deletion remains hidden until its canonical revision arrives. Old accepted receipts cannot restore later server deletions.
- Local errors retain the chosen action and source text with Retry and Copy. Pending changes have Retry, Copy retained text and confirmed Discard. Unknown delivery and accepted effects awaiting download prevent discard from claiming a false outcome. Retrying preserves the frozen UUID and envelope.
- Public REST/OpenAPI operation shapes are unchanged. Shared native request validators, Tauri command registration and local-only permissions are updated together. The duplicate title fixtures are shared by native and REST tests.

## Executed evidence

| Check | Result |
| --- | --- |
| Bun workspace tests | All 8 tasks passed (including unchanged cached suites). |
| Workspace typecheck | All 6 tasks passed. |
| Ultracite fix | Passed after extracting status rendering and fixing reported lint issues. |
| Full native suite | 75 passed; 1 existing OS clipboard test failed with `clipboard_unavailable`, including an isolated rerun. |
| Lifecycle native regression tests | All 10 passed within the native suite. |
| REST lifecycle/deletion integration | 18 passed, 116 assertions against isolated PostgreSQL and the production Bun/Next.js server. |
| Native HTTPS lifecycle journey | Passed: browser device approval, Windows Credential Manager, SQLite process restarts, reconnect, both text/delete arrival orders, metadata refusal/discard, lost conflict receipt with successor editing, later deletion/replay, and usage retention. |
| Desktop browser/native journeys | All 6 passed in headless Edge, including lifecycle and cancellation. |

The red/green native tests exposed and then verified corrections for missing lifecycle commands, loss of metadata during text coalescing and live updates, lost successor chains, retained duplicate titles and local I/O rollback. The REST suite also verifies quota refusals and atomic storage-failure rollback before preservation/deletion can commit.

The HTTPS lifecycle journey controls the external clipboard write boundary explicitly; it does not certify OS clipboard availability. The production clipboard implementation is unchanged. No release-signed installation, Windows reboot or power-loss claim is made.
