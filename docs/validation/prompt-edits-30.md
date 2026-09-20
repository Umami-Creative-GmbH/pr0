# Concurrent web prompt edits — issue #30

Validated on Windows on 2026-09-20 with Bun 1.4.2, Next.js 16.3.5, the isolated PostgreSQL 17 acceptance service and installed Chrome through Playwright. The starting commit was `c24378e3f0a8fe599073d59db428569c13aea34c`.

## Delivered behavior

- Explicit updates submit the full baseline and desired text, expected revision, changed fields and an immutable operation identity. Independent fields combine; equal desired/current text is unchanged. Actual saved changes advance modification dates.
- Competing text keeps accepted fields in the original and preserves the complete incoming variant in one active, unfavorited conflict copy with fresh dates and no usage. Independent fields still combine in the original. Receipts retain stable copy/notice identities.
- Copy, original changes, quota counters, durable conflict notice, change record and receipt commit together. A compact request fingerprint survives refused effects, so retries retain their identity while corrections require a new identity. No prompt text is stored in that fingerprint.
- Conflict notices retain the complete source title, including when the generated copy title must be shortened at a Unicode code-point boundary. Retained title bytes count toward capacity. Notices are available through scoped, paginated REST and the persistent Conflicts to review entry. The later combined review slice owns acknowledgement actions.
- The browser keeps drafts separate from incoming records and permits successor typing while an edit is in flight. A conflict receipt maps the successor to the copy and identifies it visibly. An older acknowledgement never certifies the newer draft. Failed saves retain correction, retry and clipboard recovery in the open tab.
- Migration 008 extends the existing schema without changing prior migrations. No native command or permission is exposed by this web-only slice.

## Reproduce

From the repository root:

```powershell
bun --env-file=apps/web/tests/social.env apps/web/tests/prompt-edits-runner.ts
bun run typecheck
bun run test
```

The acceptance runner starts isolated PostgreSQL/SMTP containers, migrates, builds and serves the production application, runs issue #29 and #30 regression checks, restarts the server, verifies retained conflict data and receipt replay, and removes only its own test services/volumes. Provider responses are fixture-controlled; library operations use the production public REST interface and validated client. Storage-failure injection happens at the external PostgreSQL boundary; assertions use REST.

## Observed results

- 21 REST/browser acceptance tests passed (148 assertions), followed by one restart test (4 assertions).
- Workspace test task passed: 66 prototype tests, 17 API client tests and 7 web tests. Unchanged workspace tasks may be served from Turbo's cache.
- Workspace typecheck and production build passed.
- Scoped Ultracite checks passed for changed code and the web source tree, including the repository's React Doctor rules.
- The standalone `bun x --bun react-doctor@latest --verbose --scope changed` command could not produce a score: React Doctor 0.9.14 crashed under Bun/Windows with `child.channel?.unref is not a function`. No Node fallback was introduced.
- Repository-wide Ultracite found existing issues in the research scripts. Its unrelated formatting changes were reverted; the task's scoped checks pass.

Coverage includes two authenticated browser sessions, independent and competing edits, unchanged saves, equal desired text, response loss and replay, successor drafts, full long-title retention, tied-revision pagination, foreign-account isolation, both quota limits, correction at capacity, injected storage failure with atomic rollback, incoming-data draft retention, real clipboard recovery, and server restart.

Concurrent browser page loads can reach the existing four-active-requests-per-account admission limit. Read queries use bounded retries respecting server retry guidance; save retries remain explicit. Tests finish the browser journey before issuing separate verification reads.

Screenshots: [preserved copy and persistent notice](../evidence/issue-30-conflict-copy.png), [quota refusal retaining the draft](../evidence/issue-30-quota-draft.png). These are local production-build checks, not deployment, native/offline, deletion-conflict, or complete MVP release certification.
