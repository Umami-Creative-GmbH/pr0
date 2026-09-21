# Offline desktop search — issue #50

The desktop searches the Rust-owned SQLite projection through validated native commands. Schema version 6 replaces the overlay-only index with a persisted index of all visible downloaded and locally edited prompts. A transaction drains changed prompt identities before committing primary data and the outbox. Organization names and usage metadata have separate update paths. Search uses field-specific compact trigram candidates, adaptive one/two-code-point postings, exact substring verification, and revision-bound pages. Body verification is limited to 64 rows and 4 MiB per batch; the SQLite page cache is 64 MiB, with no retained body cache.

The UI supports the five scopes, all sort choices, per-view browsing preferences, collection/tag/favorite filters, unavailable filter identities, paging, cancellation, identity-based selection and fresh detail reads. Explicit index recovery builds replacement derived tables transactionally in the WAL after checking disk space. Primary records and pending operations survive recovery.

## Validation

- Shared JSON fixtures drive Rust native commands and the public REST tests: Unicode normalization and literal punctuation across all five fields, six relevance tiers, all sorts, recency, combined filters, archive/collection scopes and later pages.
- Native tests cover restart persistence, corruption/recovery, incompatible normalization, stale cursor rejection, cancellation, off-page selection and replacing records in a full 10,000-prompt library. The existing migration test now recreates the historical schema before exercising the upgrade.
- Public REST suite: 48 tests, 150 assertions passed. Desktop search interaction and existing offline-copy interaction tests passed. A synthetic account generation change clears obsolete search actions and retains the open editor draft.
- Root unit tests, all 75 native tests, workspace typechecking, Ultracite and the desktop production build passed.

## Maximum-library measurement

[Raw measurements](issue-50-search-capacity.json) and [actual WebView2 screenshot](issue-50-desktop-search.png) were captured on Windows, AMD Ryzen 9 9950X3D2, approximately 94 GiB RAM, WebView2 153.0.4234.48, Bun 1.4.2, with optimized Rust and production Vite assets.

The synthetic library contains exactly 10,000 prompts and 100 MiB of stored text. It is downloaded through real native snapshot commands, then reopened in a new Tauri process. The benchmark uses the production command handlers and native IPC; no JavaScript IPC replacement is installed. Only account approval and initial snapshot transport are fixtures. Each sample measures the input event through the rendered result frame, including the 20 ms debounce. One first-query sample is recorded separately; p95 is the nearest-rank value of 20 subsequent samples. Each result count is checked and each warm p95 must be at most 150 ms.

| Query | First query | Warm p95 |
| --- | --: | --: |
| `a` | 35.1 ms | 44.4 ms |
| `C++` | 35.9 ms | 52.9 ms |
| `common` | 34.0 ms | 41.8 ms |
| `abcd` (10,000 trigram candidates, zero exact matches) | 108.7 ms | 90.6 ms |
| `prompt common` | 34.7 ms | 52.6 ms |
| 197-character, 25-term query | 111.7 ms | 97.4 ms |

The new desktop process reached its first rendered browsing page in 505 ms, including WebView startup. Completing the remaining 98 download pages took 60.0 seconds; the final SQLite file was 255,082,496 bytes. The OS file cache was not flushed. These figures establish process-cold reopening and warm retrieval on this machine, not minimum-hardware certification, OS-cache-cold latency, Unicode-heavy maximum dictionary growth or memory-pressure behavior. Those broader release workloads remain separate from this evidence.

## Reproduce on Windows

Use the repository's Bun and Rust toolchains, Windows SDK manifest tool and installed WebView2 runtime. Run from the repository root:

```powershell
bun install --frozen-lockfile
$env:VITE_API_BASE_URL = 'https://instance.example'
bun run --cwd apps/desktop build
cargo test --release --features search-webview-test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --locked --no-run
$nativeTest = Get-ChildItem apps/desktop/src-tauri/target/release/deps/pr0_desktop_lib-*.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
mt.exe -manifest apps/web/tests/webview.manifest "-outputresource:$($nativeTest.FullName);#1"
bun test apps/web/tests/desktop-search-capacity.test.ts
```

The opt-in test feature embeds production assets and registers the production handlers in an isolated test window. Rust unit-test executables do not receive Tauri's application resource manifest, so the `mt.exe` step supplies Common Controls v6 to this test executable. Ordinary native tests do not enable the WebView test feature or require that step. The benchmark creates and removes its own temporary account, library and WebView profile; it does not modify a user's installed library.

## Standards

Review findings about slot reclamation at maximum capacity and actionable disk-space recovery errors were resolved and verified. No remaining reported finding.

## Spec

Review findings about index-version admission, stale actions after search failure, field-specific candidate use, and validation before normalization were resolved and verified. No remaining reported finding.

Review totals: Standards 0 open findings; Spec 0 open findings.
