# Web prompt lifecycle — issue #31

Implementation starts at `32cbf46ffb5cdf1da99b95c7ca9c1099b00fc674` on `main`.

## Delivered behavior

- Favorite, duplicate, archive and restore controls are available in list and detail, with active, favorites and archive views. Actions use the authenticated REST client and wait for server acknowledgement. The editor retains its draft when lifecycle actions change view eligibility.
- Favorite and archive are typed `prompt.update` fields with explicit baseline/desired values and exact changed fields. Independent text edits combine with them. Unchanged requests and equal current values retain prompt modification dates; changes record field revisions. Replays return the original receipt.
- `prompt.duplicate` carries a new prompt identity, source identity and captured full text. The transaction checks source ownership without rereading its text. The duplicate is active, unfavorited, with fresh authoritative dates and no inherited usage. Long titles gain a Unicode-safe suffix and retain the complete source title in detail and byte accounting.
- Archive retains text, favorite and usage. Filtering occurs before pagination; signed cursors bind view, account, instance, recovery epoch, limit and library revision. Archive does not free quota. Views do not change which retained prompts can be fetched by identity for editing or a later common Copy action.
- Automatic selections are stored by identity. Canonical detail state checks eligibility even before all pages are loaded; known excluded candidates are skipped and stale lists refreshed. Older detail data cannot override a newer list revision.
- An uncertain browser action retains its immutable payload and UUID for explicit replay. Quota refusal retains the duplicate snapshot with retry, dismissal and clipboard recovery. An open draft and an unresolved action both participate in the existing navigation/sign-out protection.
- Migration 009 adds metadata revisions and retained duplicate titles without rewriting prior migrations. No native commands or permissions change in this web slice. Organization creation/assignment and the common Copy/search journeys remain separate slices; the current production schema has no organization assignments to discard.

## Reproduce

```powershell
bun --env-file=apps/web/tests/social.env apps/web/tests/prompt-lifecycle-runner.ts
bun run typecheck
bun run test
```

The runner builds and serves the production Next.js application under Bun, using isolated PostgreSQL 17 and SMTP containers. It runs lifecycle, create and edit REST/browser regressions, restarts the application, and verifies retained state and duplicate receipt replay. All behavioral assertions use public requests or browser UI; capacity and pre-existing usage are seeded at the external database boundary.

## Evidence

Targeted keyboard journeys passed in installed Chrome through Playwright on Windows with Bun 1.4.2 and Next.js 16.3.5. They cover archived editing, restoration, lost duplicate replies, exact payload replay, quota errors, retained clipboard recovery and an open draft surviving an archive action. Screenshots were visually inspected: [restored favorite](../evidence/issue-31-lifecycle.png), [quota recovery](../evidence/issue-31-quota.png).

Scoped Ultracite checks and workspace typechecking passed. The standalone React Doctor 0.9.14 scan crashed under Bun/Windows with `child.channel?.unref is not a function`, so no score comparison is available. Repository React Doctor lint rules run through Ultracite. No Node fallback was introduced.

## Observed checks and review

- The complete runner passed 33 REST/browser tests with 212 assertions, then the server-restart test with 5 assertions.
- Workspace tests passed: 66 prototype, 19 API client and 7 web tests. Unchanged Turbo tasks were served from cache. Workspace typecheck and the production build passed.
- Review identified an unnecessary incomplete Recents API scope and two selection defects. The scope was removed; usage retention remains covered through active/archive/detail requests. Selection corrections received a failing-before/fixed-after browser regression with 52 prompts, plus a stale-list regression for multiple prompts archived in another session.
- After the first review corrections, 19 affected REST/browser regressions passed with 107 assertions. The final selection build passed all 10 browser regressions with 54 assertions, including both new selection cases. Final scoped Ultracite, workspace typecheck and the six prompt-client tests also passed.

### Standards

Zero remaining findings. The Recents schema, server and OpenAPI corrections resolve the earlier violation; the selection hook introduces no material standards violations or actionable baseline smells.

### Spec

Zero remaining findings. Automatic selection follows identity, checks eligibility beyond loaded pages, and avoids cycling through known excluded candidates. Revision checks prevent older cached state from overriding newer list results.

This evidence does not certify native/offline behavior, the later common Copy/search/organization slices, deployment, or a complete MVP release.
