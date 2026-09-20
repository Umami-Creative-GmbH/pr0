# Prompt copy and Recents — issue #38

Validated on Windows with Bun 1.4.2, production Next.js build, Chrome and disposable PostgreSQL on 2026-09-20.

## Behavior

- List, detail and search copy saved text by prompt identity. A fresh scoped REST read and current view/account checks precede the clipboard write. Main-library success does not navigate.
- All production web clipboard actions share one guard. Same-origin tabs use a Web Lock with `ifAvailable`; contention rejects without queueing. Draft recovery copying uses the same boundary but records no prompt use.
- A successful write alone creates a UUID `prompt.use` operation. Its occurrence time is captured after writing. Failed writes expose Retry copy and create no use.
- Usage delivery is separate from clipboard success. One metadata-only pending event is retained in memory, bounding fallback storage. Retry usage sends the identical envelope without copying again. Further saved-prompt copies wait for explicit retry or discard. Leaving the tab does not promise survival.
- PostgreSQL commits usage, library/prompt projection revision, receipt and change together. First acceptance caps future time; replays reuse the stored correction. Maximum accepted occurrence time determines recency; modification dates remain unchanged. Deleted identities receive no resurrection; archive retains usage.
- Recents lists distinct active used prompts, defaults to Recently used and retains normal query/filter/sort/pagination behavior. Equal use times follow normalized title and UUID order. Duplicates and conflict copies retain their existing zero-usage creation behavior.
- No native commands or permissions changed. Variable filling remains outside this slice. Shared usage conformance inputs live in `packages/api-contract/src/prompt-use-fixtures.ts`.

## Evidence

- `bun run --cwd apps/web test:prompt-use`: 33 REST/browser/search-regression tests plus 1 process-restart test passed. Covers exact text, rejected and delayed writes, cross-tab contention, selection changes, account switching, transport failure, lost acknowledgement, injected PostgreSQL receipt failure/rollback, usage-only retry, future replay, delayed old usage, invalid dates, ownership, archive/restore/delete, duplicate isolation, Recents pagination/search and restart persistence.
- `bun run typecheck`: all six workspace typecheck tasks passed.
- `bun run test`: root suite passed (66 prototype, 25 client and 7 web tests); the subsequently added usage client test also passed in the focused 13-test prompt-client suite.
- Ultracite formatting and lint checks passed for all changed TypeScript, TSX and JSON files, including the integrated React Doctor rules.
- Full repository lint also reports existing violations in `docs/research/search-parity/*.mjs`; unrelated formatter changes were reverted.
- Standalone React Doctor 0.9.14 could not produce a score under Bun/Windows: `child.channel?.unref is not a function`. No Node fallback was used.
- [Recents search and copy confirmation](../evidence/issue-38-recents.png) captured from the real browser test and visually inspected. Exact text is asserted at the clipboard API boundary; Windows OS clipboard CRLF conversion is normalized only when checking pasted text.

The acceptance harness uses real REST persistence and authenticated browser controls. Failure injection is confined to external clipboard, transport and PostgreSQL boundaries; no production test endpoints were added.
