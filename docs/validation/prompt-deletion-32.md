# Permanent prompt deletion — issue #32

Implementation baseline: `775902ec84259af5d7472442722ebf656a0d0a0d` on `main`.

## Behavior

- Active and archive list/detail controls open a modal confirmation with permanent-deletion wording, initial Cancel focus, Escape cancellation and focus restoration. Cancellation sends no mutation. Confirmation captures the displayed prompt revision; fetching later data cannot silently advance that baseline.
- `prompt.delete` uses the authenticated, validated mutation client and carries an operation UUID, prompt UUID, baseline revision and dependencies. Migration 010 adds account-scoped permanent deletion markers. Deletion, quota adjustments, any conflict copy/notice, change record and compact receipt commit in one serialized transaction.
- An unseen text revision causes stale deletion to preserve the current complete title/description/content before removing the original. Favorite/archive-only revisions do not cause unnecessary preservation. A later text edit of a deleted prompt preserves its complete incoming variant in an independent active, unfavorited copy with fresh dates and no usage. Metadata-only edits cannot recreate the original.
- Quotas use the resultant state, including retained conflict source titles. Replacing an original with its conflict copy can succeed at the prompt-count limit, but still requires enough text capacity. Quota/storage failure commits neither partial deletion nor preservation. The frozen pending deletion remains available for retry; an open editor keeps its draft, including when the original is deleted.
- Replays return the original receipt after later deletion without recreating the original or copy. Reusing a deleted identity with identical text and a new operation is rejected. Deleting a conflict copy removes its notice and retained source title and releases their quota. Deleting an original leaves independent copies available; notices explicitly identify a permanently deleted original.
- Shared schemas and generated OpenAPI cover the deletion operation and notice state. Shared conformance fixtures capture the description-edit/deletion variant. No native commands or permissions change in this web slice. Organization assignments and production usage submission are not exposed by the existing slice; unsupported usage mutations remain rejected.

## Reproduce

```powershell
bun run --cwd apps/web test:prompt-deletion
bun run typecheck
bun run test
```

The acceptance runner builds and serves the production Next.js application under Bun with disposable PostgreSQL 17 and SMTP containers. It runs deletion, lifecycle, edit and creation tests through public REST/client and browser interfaces, then restarts the server to verify deletion, preservation, quota and receipt persistence. Capacity seeding and injected storage failure use the external persistence boundary; assertions use public operations.

## Evidence

Recorded on Windows build 26200, Bun 1.4.2, Next.js 16.3.5 and Chrome 154.0.8037.44 through Playwright. The production browser journeys cover keyboard cancellation in both scopes, active-list and archive-detail confirmation, lost deletion replies with exact replay, unseen edits, open-draft recovery, explicit deleted-original notices, and capacity-refused deletion followed by freeing space and retrying the frozen intent.

Visually inspected artifacts: [archive confirmation](../evidence/issue-32-confirmation.png), [preserved unseen edit and open draft](../evidence/issue-32-preservation.png), [capacity refusal](../evidence/issue-32-capacity.png).

Final production acceptance passed: 46 tests with 294 assertions, followed by the restart check with 5 assertions. Workspace tests passed: 66 prototype tests, 20 API client tests and 7 web tests. Unchanged Turbo tasks used cached results. Workspace typechecking, production build and scoped Ultracite checks passed.

The first broad acceptance run passed all 11 deletion checks and exposed a timing-sensitive existing selection assertion: network idle did not consistently imply the selected detail had rendered. The test now waits for its expected visible heading. Final regression runs also exposed the account's four-request admission limit during concurrent browser initialization and a direct REST assertion overlapping background refreshes. Session initialization now runs sequentially while both editors remain open for the conflict scenario; the deletion assertion waits for refresh requests to finish. Editor waits allow the API's five-second admission retry. No selection or admission implementation changed.

## Review

Both specification findings were reproduced with failing browser regressions and corrected: persistent review links resolve the prompt's current active/archive view, and a retained successor editor checks canonical original availability before offering its link. The extended journey delays a post-deletion edit acknowledgement, retains newer text, saves it onto the preserved copy, and opens that copy from Archive.

### Standards

Zero hard violations and zero remaining advisory findings. Shared conflict-copy preparation and persistence resolve the initial duplication advisory while keeping transaction and resultant-quota decisions with each mutation.

### Spec

Zero remaining findings after the two browser corrections. Atomicity, ownership, identity rejection, receipt replay and frozen deletion baselines passed review.

The standalone React Doctor 0.9.14 scan failed under Bun/Windows with `child.channel?.unref is not a function`; no standalone score comparison is claimed. Integrated React Doctor lint rules pass through Ultracite. The repository-wide lint command also reports existing research-harness violations; incidental formatter changes outside this ticket were reverted.

These checks cover the web slice. They do not certify native/offline behavior, installed Windows journeys, manual screen-reader testing, deployment, or the complete MVP.
