# Prompt copy and Recents — issue #38

Validated on Windows with Bun 1.4.2, production Next.js build, Chrome, Playwright WebKit 26.6 and disposable PostgreSQL on 2026-09-20.

## Behavior

- List, detail and search copy saved text by prompt identity. A fresh scoped REST read and current view/account checks precede the clipboard write. Main-library success does not navigate.
- All production web clipboard actions share one guard. Same-origin tabs use a Web Lock with `ifAvailable`; contention rejects without queueing. Draft recovery copying uses the same boundary but records no prompt use.
- Clipboard API initiation stays in the original click handler using a promise-backed ClipboardItem. The promise supplies bytes only after exclusive admission and eligibility checks; the lock remains held through OS completion. This handles [WebKit's asynchronous activation constraint](https://bugs.webkit.org/show_bug.cgi?id=222262). Separate payload and completion promises prevent a lock/write deadlock.
- A successful write alone creates a UUID `prompt.use` operation. Its occurrence time is captured after writing. Failed writes expose Retry copy and create no use.
- Usage delivery is separate from clipboard success. One metadata-only pending event is retained in memory, bounding fallback storage. Retry usage sends the identical envelope without copying again. Further saved-prompt copies wait for explicit retry or discard. Leaving the tab does not promise survival.
- PostgreSQL commits usage, library/prompt projection revision, receipt and change together. First acceptance caps future time; replays reuse the stored correction. Maximum accepted occurrence time determines recency; modification dates remain unchanged. Deleted identities receive no resurrection; archive retains usage.
- Recents lists distinct active used prompts, defaults to Recently used and retains normal query/filter/sort/pagination behavior. Equal use times follow normalized title and UUID order. Duplicates and conflict copies retain their existing zero-usage creation behavior.
- No native commands or permissions changed. Variable filling remains outside this slice. Shared usage conformance inputs live in `packages/api-contract/src/prompt-use-fixtures.ts`.

## Evidence

- `bun run --cwd apps/web test:prompt-use`: 36 REST/browser/search-regression tests plus 1 process-restart test passed. Covers exact text, rejected and delayed writes, cross-tab contention, selection changes, account switching before and during clipboard writing, transport failure, lost acknowledgement, injected PostgreSQL receipt failure/rollback, usage-only retry, future replay, delayed old usage, invalid dates, ownership, archive/restore/delete, duplicate isolation, Recents pagination/search and restart persistence. A deterministic gesture-boundary regression failed before the ClipboardItem fix and passed afterward. Real WebKit clipboard writing and text readback passed; only clipboard-read permission is pregranted in that test. This is engine validation on Windows, not a macOS Safari release certification.
- `bun run typecheck`: all six workspace typecheck tasks passed.
- `bun run test`: root suite passed (66 prototype, 25 client and 7 web tests); the subsequently added usage client test also passed in the focused 13-test prompt-client suite.
- Ultracite formatting and lint checks passed for all changed TypeScript, TSX and JSON files, including the integrated React Doctor rules.
- Full repository lint also reports existing violations in `docs/research/search-parity/*.mjs`; unrelated formatter changes were reverted.
- Standalone React Doctor 0.9.14 could not produce a score under Bun/Windows: `child.channel?.unref is not a function`. No Node fallback was used.
- [Recents search and copy confirmation](../evidence/issue-38-recents.png) captured from the real browser test and visually inspected. Exact text is asserted at the clipboard API boundary; Windows OS clipboard CRLF conversion is normalized only when checking pasted text.

The acceptance harness uses real REST persistence and authenticated browser controls. Failure injection is confined to external clipboard, transport and PostgreSQL boundaries; no production test endpoints were added.

## Code review

Independent Standards and Spec reviews used base `f39e0c379677ff218fb0c3d1a967631a8eb28d22` and implementation commit `160fd14`, followed by a review of the clipboard correction.

### Standards

No documented-standard violations. Two nonblocking heuristic findings remain: copy eligibility overlaps selection eligibility, and UI/server/cursor code repeats default-sort resolution. A shared predicate/resolver would reduce future maintenance drift; neither finding indicates incorrect current behavior.

### Spec

The initial review identified loss of Safari clipboard activation after asynchronous preparation. The promise-backed ClipboardItem correction was reviewed again with no remaining correctness findings and validated in real WebKit and the browser failure/concurrency suite.

Final review: Standards 0 hard violations and 2 nonblocking duplication concerns; Spec 0 unresolved findings (1 corrected).
