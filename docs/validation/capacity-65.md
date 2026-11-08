# Capacity validation for issue #65

This work adds repeatable capacity workloads and fixes measured search/indexing overhead. It does **not** establish that #65's release budgets are met. The ticket remains open. The user authorized this Windows host for supporting evidence; it is not the required four-core, 8 GiB SSD benchmark machine.

## Environment and scope

[Host inventory](../evidence/issue-65-host.json) records Windows, CPU, RAM, SSDs and the Linux Docker VM. The desktop uses a release-profile native test executable with production Vite assets and real WebView2/typed native commands. Snapshot transport and account credentials are fixtures. The worker does not start production background synchronization loops, so its ten-minute process-tree sampling is **offline supporting evidence**, not the settled online/no-backlog gate. Other validation work ran concurrently on this host.

The service fixture runs production images on Linux x86-64. Web, PostgreSQL, mail, SMTP and both deletion ledgers share CPUs 0 and 1; memory limits total 3,776 MiB. Docker's backing disk and kernel are shared. No dedicated 64 GiB disk or physical two-vCPU/four-GiB machine is claimed. The fixture uses a private trusted-ingress secret and distinct synthetic source IPs only for account provisioning, preserving production sign-in throttles.

## Changes prompted by measurements

- Native short postings now collect bounded, transaction-local bitmaps before persistence instead of repeatedly expanding dense postings into trees. The cache retains at most 16,384 entries, below 21 MiB of bitmap payload, and is released before commit. Existing minimal sparse/run/bitmap encodings and transaction boundaries remain.
- Native query candidates use fixed-domain membership bitsets; unfiltered searches avoid decoding every tag array. A revision-bound organization-name cache and compact metadata/count projection remove repeated canonical-body scans from search and status paths. Mutation admission and recovery retain canonical reads. Full SQLite/FTS integrity checks remain enabled.
- Server bitmap updates modify a bit and compute cardinality/run counts without allocating and sorting thousands of entries. Public REST and native regressions verify complete dense postings after changes and restart.
- Large compact collection/tag pickers open through keyboard-accessible native disclosures. This removes 1,200 unopened choices from render/focus paths and bounds option scrolling. Every option and selected identity remains available. The native prompt footer scrolls rather than covering final actions.
- Opening the native editor fetches a fresh command snapshot. Copy updates local usage/revision; reusing an older detail snapshot caused a subsequent save refusal. Draft account/instance fences remain.
- Bun is pinned to 1.4.4 in deployment/tooling and CI. On the previous Linux 1.4.2 runtime, a reserved SQL transaction was terminated by the pool's idle timeout during long index preparation. An isolated transaction with a one-second idle timeout and a two-second asynchronous pause failed on Linux 1.4.2 and completed on Linux 1.4.4. The separate CPU-bound pause completed on both versions in the retained reproducer. [Raw runtime comparison](../evidence/issue-65-sql-lifetime.json) and `apps/web/tests/capacity-sql-lifetime.ts` retain that distinction. No database pool timeout or durability policy was weakened. The Docker digest is pinned for reproducibility. [Bun SQL transaction documentation](https://bun.com/docs/runtime/sql).

## Workload and evidence

The deterministic desktop corpus contains exactly 10,000 prompts and 104,857,600 logical UTF-8 bytes, including title, description, content, 200 collection names and 1,000 tag names. Every prompt has 20 tags; Unicode-heavy noisy bodies avoid tiny compressible placeholder content. Search samples include a one-character term, punctuation, common body content, all five fields, Greek/CJK, emoji, a near-limit multi-term query, and an absent query. The added `abcd` case has trigrams present in all bodies but exactly seven literal matches in the deterministic noise; it forces exact verification of the full candidate set. Typed pagination checks all 10,000 identities with no duplicates after persisted restart. Search timing starts at input dispatch and ends after result commitment plus two animation frames, including the production debounce.

The original launcher samples included Playwright actionability waits on an inactive surface. [Alternating trigger diagnosis](../evidence/issue-65-launcher-trigger.json) separated that overhead: subsequent Playwright clicks took about 2.96 seconds to dispatch, whereas direct DOM activation took 7–24 ms and reached native focus in another 1–6 ms. The revised collector records one warm-up separately, then twenty main-button DOM activations through native focus and an enabled focused search field. This measures the main-button entry point; physical global-shortcut timing remains unmeasured. Copy and save start at the final action and end at acknowledged dialog closure plus two animation frames. These are twenty-sample nearest-rank p95s. Cold start is one process launch, not a cold-start p95 distribution. Snapshot pages are 250 records, bounded by the public contract; early baseline pages used 100 records, so download comparisons are not isolated microbenchmarks.

The service seed asserts exactly 1,000 accounts, 10,737,418,240 aggregate logical UTF-8 bytes and 109,900 prompts. One account has the maximum library; the other 999 have 100 prompts each. All 1,000 search indexes are prepared before load. Twenty authenticated accounts receive fixed arrivals: ten requests/second for 1,800 seconds and thirty/second for 60 seconds, 80% searches and 20% durable usage mutations. Timed refusals, timeouts, late dispatch and exhausted client concurrency are retained rather than retried or counted as successful throughput. Accepted usage counts are verified exactly after a production-server restart.

The REST catch-up supplement delivers 1,000 creates containing 10 MiB of desired text with receipt checks. It does **not** measure 1,000 queued native edits or the required shaped network. Inspection of native upload code confirms one operation per upload cycle; the native catch-up release gate remains open. The service image was built before the final shared-picker UI changes; its web timing observations therefore describe that earlier UI asset build. The service REST/index changes are present. The web supplement uses CDP 50 ms/20 Mbps shaping and two pages of the same browser session; it is supporting web propagation evidence, not independent desktop-device synchronization.

Raw artifacts retain initial failures:

- [Desktop baseline](../evidence/issue-65-desktop-baseline.json), [first optimization](../evidence/issue-65-desktop-first-optimization.json), [before query optimization](../evidence/issue-65-desktop-before-query-optimization.json), [before compact snapshot reads](../evidence/issue-65-desktop-before-snapshot-optimization.json), and [latest desktop run](../evidence/issue-65-desktop.json).
- [Service baseline](../evidence/issue-65-service-baseline.json), [first optimization](../evidence/issue-65-service-first-optimization.json), [provisioning throttle failure](../evidence/issue-65-service-provisioning-failure.json), and [latest service run](../evidence/issue-65-service.json).

The initial native run was stopped after 626 seconds with only 3,900 prompts indexed. An optimized complete download was approximately 128 seconds, still above 120 seconds even without network shaping. The last completed cold UI observation before compact snapshot reads was approximately 14.7 seconds, above three seconds. Common and long searches also exceeded 150 ms in that run. Supporting results cannot be promoted to release certification by omitting these failures.

The complete **foreground/offline** ten-minute run is retained separately in [desktop with residency](../evidence/issue-65-desktop-with-residency.json) and [per-process samples](../evidence/issue-65-residency.json). It failed the memory target: 1,114,820,608 bytes peak sampled private commit (about 1,063 MiB), with 0.335% mean total-host CPU over 600.9 seconds. The final sample still used about 814 MiB. Both surfaces had not been closed, so this is not the specified idle interval. The revised harness hides both through native commands, verifies visibility, allows thirty seconds to settle and records the remaining edit/usage backlog; it still does not start production sync loops. Cold UI took 12.38 seconds; launcher/copy/save p95s were 3,139/159/279 ms, respectively. Search p95s ranged from 150.4 to 219.9 ms. Complete pagination and all twenty copy/save operations succeeded. These failures remain visible; the offline worker and concurrent host activity further limit release interpretation.

## Reproduction

Use Bun 1.4.4 and Rust 1.94.0. Commands run from the repository root. Docker Desktop with Linux containers and installed Chrome/WebView2 are required for the respective harnesses.

```powershell
bun install --frozen-lockfile
bun run --cwd apps/desktop build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --release --features search-webview-test --lib --no-run
# Embed apps/web/tests/webview.manifest in the generated test executable with Windows SDK mt.exe.
$env:PR0_CAPACITY_RESIDENCY='true'
bun test apps/web/tests/capacity-desktop.test.ts

docker build --target runtime -t pr0-capacity-65 .
docker build --target migration-runtime -t pr0-capacity-tools-65 .
bun apps/web/tests/capacity-service-runner.ts --web --keep-on-failure
```

The desktop harness uses a fresh temporary library unless PR0_CAPACITY_REUSE_DIRECTORY names a retained fixture; reused runs explicitly omit initial-download timing. PR0_CAPACITY_KEEP=true retains local evidence after failure. The service runner removes its disposable Docker project normally; --keep-on-failure retains it and prints its exact location. --smoke shortens intervals and cannot pass the full-load flag. Capacity tests are explicit opt-in integration workloads, not part of the fast workspace suite.

## Remaining acceptance gates

Required-machine measurements, installed desktop cold-start p95, online initial download/indexing, actual native queued-edit reconciliation, independent cross-device visibility, settled ten-minute ordinary-sync/no-backlog residency, and disk-threshold behavior at 70%/80% are still required. Full service storage must include primary indexes, postings, WAL, scratch and both deletion ledgers under the provisional 64 GiB footprint. A load-only passed flag describes the collected subset; it does not close #65.

## Validation

The workspace suite passed 145 tests (84 contract, 49 client, seven web and five UI), and typechecking passed. The production-build REST/browser regression run passed 35 tests across dense short postings, all-field Unicode search, filters, organization management and retained editor behavior. The initial browser failures were a readiness race in the new picker helper and a pre-existing row selector that omitted the preview from its accessible name; both are corrected. The full release-profile native suite passed 169 tests, including migrations, interrupted writes, recovery, upload replay, Unicode matching and dense postings. Final capacity-run summaries are pending. No acceptance criterion has been weakened or waived.

## Review

The code-review skill reviewed the committed diff from f0a1e0d to 5b29320 in separate Standards and Spec agents. Production code has not changed after that review. Subsequent changes correct benchmark collection, permit resuming a prepared disposable service, and record more evidence.

### Standards

No documented-standard breaches or actionable baseline smells. Runtime boundaries, bounded revision-bound caches and transactional persistence are preserved.

### Spec

Two findings: (P1) release acceptance remains incomplete, including the documented memory/latency failures and missing actual native queued-edit reconciliation; (P2) the original residency harness left the library visible, contrary to “close both library and launcher surfaces and measure a continuous ten-minute idle interval” in desktop-process-model.md. P2 is corrected in the collector, and retained foreground observations are labeled explicitly. P1 remains open. No unrequested behavior or concrete preservation/matching regression was found.

Standards: zero findings. Spec: two findings at review, one collector correction applied and one set of release blockers outstanding.
