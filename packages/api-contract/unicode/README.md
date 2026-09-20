# Organization normalization data

The vendored inputs are Unicode **17.0.0**, obtained from [the Unicode Character Database](https://www.unicode.org/Public/17.0.0/ucd/). The [Unicode license](LICENSE.txt) applies to the input data and derived tables.

Run `bun packages/api-contract/scripts/generate-unicode.ts` from the repository root to regenerate `src/unicode17-data.json` and `unicode/unicode17.rs` from the same inputs. TypeScript uses the JSON tables; the Rust lookup tables are retained for the native command implementation. This web slice does not expose new native commands or permissions.

`organization.ts` implements canonical decomposition, combining-class ordering, canonical composition (including algorithmic Hangul), and default full C/F case folding without depending on host ICU. Identity trims Unicode White_Space and uses NFC → full fold → NFC, preserving accents and internal spacing. Name search uses NFD → full fold → NFD, removes only marks with Diacritic=Yes, and collapses only Unicode White_Space. Sorting compares normalized Unicode scalar values, then UUIDs.

`organization-fixtures.ts` contains literal vectors exercised through production REST, including Unicode 17 additions, sharp s, dotted I, canonical accents, Hangul, internal spaces, BOM, compatibility characters and variation selectors. Input validation rejects NUL, unpaired surrogates, blanks and names over 60 code points.
