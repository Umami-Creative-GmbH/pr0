# Issue #35: merge tags and delete organization

Validated on Windows on 2026-09-20 with Bun 1.4.2, Next.js 16.3.5, the isolated PostgreSQL/SMTP Compose fixture, and installed Chrome through Playwright. Implementation base: `96fb8893ddae50d35a4ac9fcd09ccaaec723cf47`.

## Implemented behavior

- Collection/tag deletion and explicit tag merge use singleton operations inside the existing serialized library transaction. Names, quota counters, assignments, revision, change record, durable receipt and original affected identities commit together. Prompts and their text remain intact.
- A colliding tag rename offers a separately confirmed merge. The target identity and capitalization survive; overlapping memberships are deduplicated. Deleted identities and merge aliases are scoped to the library, survive restart, resolve chains to live targets only, and retain removal history so stale assignments cannot resurrect deleted organization or bypass an explicit removal.
- Confirmation shows active and archived impact, including unused deletion. Changed names or counts require renewed confirmation. An uncertain save retains its original operation through lost responses, unavailable impact reads and transient replay refusal.
- The result shows observed counts and a paginated review of the original affected identities. Current titles, assignments, archive state and later prompt deletion are refreshed separately; this review is not an audit history.
- Removed selected filters retain their identity and named Deleted/Merged state with zero results. Replacing a merged tag or returning to All prompts requires an explicit action. A remote deletion also clears cached actionable detail when more result pages remain.
- The public contract, OpenAPI and shared client expose validated impact, removed-identity state and affected-review reads. The shared merge fixture fixes expected overlap/count behavior.

## Verification

- `bun run test`: 98 unit tests passed across the configured workspaces.
- `bun run typecheck`: all six typed workspaces passed; acceptance builds also typecheck the production app.
- `bun run --cwd apps/web test:tags`: 101 REST/browser tests passed, followed by two passing restart tests. After the final filter changes, `bun run --cwd apps/web test:tags apps/web/tests/organization-cleanup-browser.test.ts apps/web/tests/tags-browser.test.ts apps/web/tests/collections-browser.test.ts` passed all 12 browser tests, including the two new collection/remote-removal cases.
- Changed-file Ultracite formatting/lint passed, including configured React Doctor rules. `git diff --check` passed.
- Capacity tests exercise deletion and merge of 10,000 prompt assignments, force a transaction failure before retry, and verify all 100 affected-review pages. The full run measured 412 ms for deletion and 667 ms for merge; each successful request must complete in under two seconds locally. Transaction-local join planning avoids quadratic nested scans when fresh libraries lack planner statistics.
- Browser coverage includes explicit collision merge, unused confirmation/cancel, retained search/name input, focus restoration, live archived/active review, a lost accepted response followed by impact 404 and rate-limited replay, explicit filter replacement, collection deletion, and remote removal with 101 selected matches.
- REST/client regressions cover ownership, singleton envelopes, stale assignments and renames, alias chains/deleted targets, explicit removal history, quota release, frozen receipt replay, malformed responses, cancellation and persistence after a server restart.

The root `bun run check` still fails on pre-existing unrelated formatting and `docs/research/search-parity/*.mjs` lint findings. Those files are unchanged. Standalone `bun x --bun react-doctor@latest --verbose --scope changed` (0.9.14) fails under Bun/Windows with `child.channel?.unref is not a function`; no Node fallback was introduced.

## Review

Independent Standards and Spec reviews identified retry recovery, stale alias removal history and cached selection after remote deletion. Each finding was corrected and re-reviewed with no remaining actionable findings.

Native permissions are unchanged. Validation covers the web library and shared REST/client boundary, not installed-desktop or screen-reader certification.

Screenshot: [collection deletion with live affected review](../evidence/issue-35-collection-review.png).
