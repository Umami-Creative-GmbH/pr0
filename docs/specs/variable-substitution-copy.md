# Variable substitution and copying

Status: approved behavior specification for [issue #21](https://github.com/Umami-Creative-GmbH/pr0/issues/21). The user accepted all eleven decisions, including optional variable types, and confirmed the consolidated specification on 2026-09-19. This is a behavior specification, not production implementation or runtime validation.

## Authority and scope

The [MVP map](https://github.com/Umami-Creative-GmbH/pr0/issues/1) includes variable substitution. The [accepted interaction direction](https://github.com/Umami-Creative-GmbH/pr0/issues/9#issuecomment-5743990156) requires collecting values inside the launcher, preserving query and selection on back navigation, and closing for copy success only after the clipboard write succeeds. Explicit cancellation and ordinary launcher dismissal remain separate actions.

The [persistence and synchronization contract](persistence-sync-contract.md), [desktop process model](desktop-process-model.md), and [save and synchronization presentation](save-sync-conflict-presentation.md) remain authoritative except for amendments explicitly settled here. Existing literal search, input limits, personal-library isolation, and clipboard failure guarantees remain in force.

Use Prompt template, Prompt variable, and Variable value from the [domain glossary](../../CONTEXT.md). A substituted clipboard result is not a new prompt or a Prompt copy.

## Settled: variable language

Recognize variables only in saved prompt content, not titles, descriptions, collection names, or tags. The placeholder form is `{{name}}`. Names begin with an ASCII letter or underscore and continue with ASCII letters, digits, or underscores. Spaces and horizontal tabs may surround the name inside the braces; newlines and other whitespace are not permitted there. Names are case-sensitive, without case folding or Unicode normalization.

Present one field per distinct name in first-appearance order. Every occurrence of that name receives the same value. Thus `{{ name }}` and `{{name}}` share a field, while `{{Name}}` is a different variable. Names such as `__proto__` are ordinary names with no special behavior.

Substitution inserts values literally in one pass. A value containing braces, another placeholder, dollar signs, or backslashes is ordinary text and is not evaluated or scanned again. No expressions, default values, optional-value syntax, or nested substitution is introduced.

The optional type annotation is `{{name|type}}`, with spaces and horizontal tabs allowed around the name, separator, and type. Supported type names are exactly lowercase `string` and `number`. An omitted annotation means `string`; `{{name}}` and `{{name|string}}` are equivalent. Unknown or empty annotations remain literal malformed placeholders, not fallback string variables. Type annotation is optional; supplying a nonblank value is not.

Deduplicate by name, not by name/type pair. If any recognized occurrence of a name is annotated `number`, apply number validation to that name's one field and use its exact value for every occurrence, including untyped and explicit-string occurrences. An escaped or malformed occurrence contributes no field or constraint. First appearance among recognized, unescaped occurrences still determines order.

## Settled: type validation

String values may contain any nonblank, valid scalar text within the limits below, including multiple lines. Number values accept ASCII decimal text with an optional leading `+` or `-` and optional surrounding ASCII spaces or horizontal tabs. Require at least one digit; a decimal point must be followed by digits. The numeric part matches `[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)` in full.

Examples accepted as number values: `42`, `-3`, `+2.50`, `0.5`, `.5`, `001`, and `  -0.50\t` (where `\t` denotes a horizontal tab). Reject `1.`, a sign alone, commas, thousands separators, exponents, NaN, Infinity, non-ASCII digits, internal whitespace, and line breaks. Numeric validity is lexical, not a floating-point range check: preserve every accepted digit, sign, zero, and surrounding space/tab exactly. Do not round, reformat, coerce through a machine number, or impose an unstated precision limit.

Label each field with its name and effective type and give a specific validation error. A numeric keyboard hint is allowed, but browser-native number coercion must not change the accepted text. Multiline string entry uses normal line breaks; provide an explicit keyboard-accessible Copy action rather than treating a plain Enter in a multiline field as submission.

## Settled: literal and malformed placeholders

An immediately preceding backslash escapes an otherwise recognized placeholder: `\{{name}}` copies as literal `{{name}}` and creates no field. Consume only that immediately preceding backslash; preserve all others. Thus two backslashes before a valid placeholder copy as one backslash followed by the literal placeholder. This is not a backslash parity rule.

Invalid forms remain literal and do not prevent saving or copying: `{{first name}}`, `{{9name}}`, empty names, unmatched braces, and nested or triple-brace forms. Never recognize an inner valid-looking substring of a malformed nested/triple-brace form. Valid placeholders elsewhere still work. Escaping and replacement affect only the clipboard result; saved content remains exact.

For deterministic malformed-text handling, scan left to right. An opening run of at least two braces starts a candidate. Track the balance of individual opening and closing braces, including nested braces. End the candidate after the complete closing run that returns the balance to zero or below, or at the line boundary/end of content if unmatched. Include complete opening and closing runs, even when an extra closing brace makes the form malformed. Recognize the candidate only if both boundary runs have exactly two braces and the entire interior matches the variable grammar. Otherwise preserve it exactly and do not rescan its interior. Resume after that candidate. A line boundary is a CR or LF; neither may occur inside a recognized placeholder. Single braces outside candidates are ordinary text.

Apply backslash escaping only to otherwise recognized candidates. Thus `\{{count|number}}` becomes literal `{{count|number}}`, but `\{{count|unknown}}` remains unchanged, including its backslash. Escaped literals are resolved even when there are no fields to collect; ordinary Copy then writes the resulting text directly.

## Settled: limits

Each entered value and the final substituted clipboard text must be at most 256 KiB (262,144 UTF-8 bytes). Repeated occurrences count separately toward the output limit. Validate size before clipboard access and stop bounded output construction before exceeding the ceiling. Never silently truncate text. Explain whether an individual value or the combined output exceeds the limit, preserve the form, and record no use.

Valid Unicode scalar text is required; reject unpaired surrogates and U+0000 with a field error. Stored prompt limits and the 100 MiB library-text quota are unchanged. Transient values and clipboard results do not count as stored library text. No separate variable-count or variable-name-length limit is added beyond the stored content limit. The form must still expose every field through keyboard access and scrolling.

## Settled: values and retention

Every variable requires a nonblank value. Empty and whitespace-only values prevent copying, with an error identifying the field. Use the contract's pinned Unicode White_Space definition for the nonblank check; do not trim a valid value. Multiline input, leading/trailing whitespace, indentation, and line breaks are preserved exactly in the logical clipboard text.

Values belong only to the current copy interaction. Preserve them through clipboard failure so the user can edit and retry. Clear them after successful copying or cancellation. Never save or synchronize values, remember them as defaults, or put them in the library's durable offline work.

The stored template is unchanged by filling or copying. Literal search continues to search saved text under the existing retrieval rules; entered values and substituted clipboard text do not enter the search index.

## Settled: navigation and template changes

Collect launcher values inside the launcher. Back or Escape from the value form discards entered values and returns to results, preserving query, filters, sort, and selected prompt identity while it remains eligible. Escape from results or dismissing the launcher cancels the interaction. Reopening starts with empty values and the existing launcher opening defaults. In the library, Cancel returns to the originating view. Clipboard failure keeps the form, all values, and an error with an explicit retry action on both surfaces.

Ordinary focus-loss dismissal follows the desktop process decision: it becomes available only after the launcher acquired focus during that opening. Initial foreground refusal does not cancel the interaction. Actual dismissal clears values immediately, not merely when the launcher next opens.

Freeze the saved template shown when filling begins. If the app observes changed content before copying, preserve current values but block copying until the user explicitly restarts with the updated template. Carry forward values only for names still present and validate them against the updated template. A newly introduced name begins empty; removed names lose their values. Never silently substitute into a different template. Metadata-only changes do not require restarting.

Type annotations are content changes. If an existing string variable becomes numeric, retain its entered text on explicit restart but revalidate it; invalid text blocks copying until corrected. Refreshing the template never automatically copies, even if the refreshed template has no variables. Show the updated content and require a fresh Copy action.

If the prompt is observed deleted, or archived while filling in the launcher, block copying, discard values, and return to results using the existing eligibility/selection rules. Archived prompts remain copyable from the library's archive. The app cannot detect an unseen remote change while offline; these checks use the latest locally available state.

Sign-out, account/instance switching, confirmed account deletion, and process/page termination end the interaction and clear its values. Do not transfer them through the clipboard, URL, cross-window shared state, or remembered form defaults to preserve them. Losing online authentication alone does not select another account or erase the established offline library; its existing partition-access rules still apply.

## Settled: one in-flight write

Allow one application-managed clipboard write at a time through the common clipboard boundary. In particular, desktop library and launcher windows share the same guard. Another surface attempting to copy shows that copying is already in progress; it retains its values and does not enqueue a later implicit write. After the pending attempt finishes, another copy requires explicit activation. This coordinates pr0's own writes, not other applications using the system clipboard.

Freeze the submitted output and temporarily disable its form's value editing, Copy, Back, Cancel, and equivalent Escape navigation; defer ordinary launcher blur dismissal while it is pending. A failed write restores the form and its values for explicit retry; successful writing clears values and closes the launcher. Account/instance transitions still clear values immediately and invalidate unstarted work. An already-started OS clipboard write cannot be rolled back. Its eventual completion belongs only to the original account/instance and must not update a new account's UI, recency, or pending work.

Defer means that blur does not itself hide the pending form. On failure, retain the launcher with the error; do not bring it to the foreground or steal focus. On success, hide it normally. Forced process/page termination cannot promise cancellation or reporting of an OS write already in progress.

## Existing copy guarantees

A failed clipboard write records no Prompt use and retains an actionable error and retry path. A successful substituted write counts as a use of the original prompt, with the existing UUID usage operation and occurrence-time rules. It does not modify prompt content, modification time, or identity.

Clipboard success remains success if subsequent usage persistence fails. Report the separate failure and retain the existing best-effort in-memory usage retry. Retrying usage delivery must never repeat the clipboard write. Deleted prompts are not resurrected by usage; archived prompts retain usage without entering active Recents.

Desktop copying remains available for downloaded prompts offline. It uses Rust's clipboard and account authority boundary. No database transaction spans human input or clipboard access. These inherited guarantees are not new persistence or API features.

## Persistence and shared-contract amendment

The original [issue #10 resolution](https://github.com/Umami-Creative-GmbH/pr0/issues/10#issuecomment-5743817032) predates substitution. The [contract amendment](persistence-sync-contract.md#variable-substitution-amendment-issue-21) explicitly includes this feature while retaining template text as the only stored content. No variable-value tables, remembered-value preferences, substituted-content records, synchronization payloads, backup fields, or new REST mutation kinds are introduced.

The shared contract must specify identical tokenization, type aggregation, value validation, escaping, substitution, and UTF-8 output limits for web and desktop, with common conformance cases. Store annotations as part of existing prompt content. Do not reject a saved template merely because a placeholder is malformed; malformed forms are literal text. Search indexes saved content literally under the existing search contract, including braces and type annotations.

Values and substituted text remain within the active client copy interaction and its clipboard boundary. Exclude them from logs, telemetry, URLs, usage records, operation receipts, browser storage, native databases, and crash-report attachments under application control. Usage carries the existing prompt identity and occurrence-time metadata only. Clearing application state does not erase the user's clipboard or promise control over OS clipboard history, third-party clipboard managers, swap, or external crash capture.

Before initiating a write, validate the current account/instance generation, local prompt eligibility, unchanged template, values, and output bounds. Desktop Rust must enforce its existing native authorization boundary rather than trusting a renderer-supplied account or bypassing local checks. Once a write is underway, no atomic transaction with the operating-system clipboard is promised. An observed late edit/deletion cannot undo a successful write or authorize a silent second write.

The specification extends behavior and conformance requirements, not database schemas or wire payloads. The final readiness decision must link this amendment and the canonical specification; resolving #21 does not itself resolve readiness #12.

## Settled acceptance examples

| Scenario | Expected behavior |
| --- | --- |
| Content is `Hello {{name}}; {{ name }} meets {{Name}}.` | Fields appear as `name`, then `Name`; the first field fills both lowercase occurrences. |
| Content is `{{text}}`; its value is `Keep {{other}} and $&` | Copy exactly `Keep {{other}} and $&`; do not request `other` or interpret replacement syntax. |
| A value is empty or contains only Unicode whitespace | Block copying, identify the missing value, and record no use. |
| A value is nonblank with indentation and newlines | Preserve that text exactly when inserting it. |
| Clipboard writing fails after valid values are supplied | Retain values and offer retry; do not record use. |
| Clipboard writing succeeds | Record use of the original prompt, clear transient values, and preserve the saved template and modification time. |
| Clipboard succeeds but usage storage fails | Keep copy success, report the usage failure separately, and retry only usage delivery. |
| Content is `{{a}} / {{a\|number}} / {{a\|string}}`; value is `+02.50` | Show one numeric field and copy `+02.50 / +02.50 / +02.50`. |
| Content is `{{x\|strng}} {{y}}`; value of `y` is `ok` | Show only `y`; copy `{{x\|strng}} ok`. |
| Content is `{{ count \t\|\tnumber }}` (tabs indicated by `\t`) | Recognize one numeric field named `count`. |
| A numeric field contains `1,5`, `1e3`, `NaN`, `1.`, or a newline | Block copying with a numeric-format error; preserve entered text. |
| A numeric field contains `9007199254740993` | Copy those exact digits without floating-point rounding. |
| Content is `\{{x\|number}} {{x}}`; value of `x` is `word` | Show a string field; copy `{{x\|number}} word`. |
| Content is `\\{{name}}` | Ask for no value; copy one backslash followed by literal `{{name}}`. |
| Content is `{{{x}}} / {{outer {{inner}} }} / {{ok}}`; `ok` is `yes` | Show only `ok`; preserve both malformed forms and copy `{{{x}}} / {{outer {{inner}} }} / yes`. |
| Content is `{{outer {{a}} {{b}} }} {{ok}}`; `ok` is `yes` | Neither `a` nor `b` creates a field; copy `{{outer {{a}} {{b}} }} yes`. |
| Content is `{{broken` followed by a newline and `{{ok}}` | Preserve the unmatched first line; recognize `ok` on the next line. |
| Content is `{{x}}{{x}}`; `x` contains 131,072 ASCII `a` characters | Accept the exact 262,144-byte output. One additional `a` in the value exceeds the output limit and blocks copying. |
| A value contains 65,536 U+1F600 emoji | Its 262,144 UTF-8 bytes fit the value limit; one additional emoji fails. Surrounding template text can still make the output too large. |
| A value contains NUL or an unpaired surrogate | Reject it with a field error, preserve the form, and perform no write or usage operation. |
| Back from the launcher value form, then reselect the prompt | Preserve search/filter/sort/eligible selection; show empty values on reentry. |
| Dismiss the launcher after it acquired focus | Clear values immediately; no invisible retained form values. Initial focus refusal alone does not dismiss it. |
| Template changes from `{{x}}` to `{{x\|number}} {{y}}` while filling | Require explicit restart; retain `x` but apply numeric validation, add empty `y`, and require another Copy action. |
| Prompt is deleted, or archived during launcher filling | Block copying and return to eligible results with values cleared. Library archive copying remains available. |
| Switch accounts while filling | Clear values and prevent any old interaction from reading/writing the newly selected partition. |
| Copy succeeds while the library is at its storage quota | Preserve copy success; transient output consumes no stored-text quota and normal usage remains allowed. |
| Activate Copy repeatedly while a write is pending | Perform one write; disable repeated submission and navigation until it resolves. One successful write generates one usage operation. |
| Copy from the desktop library while a launcher write is pending | Do not start or queue another write; retain the library interaction and require an explicit later Copy action. |
| Launcher loses focus while a write is pending, and that write fails | Retain the form, values, and error without stealing focus; enable explicit retry. |
| Account changes after an OS write starts | Clear application values immediately; do not promise clipboard rollback. Route any completion only to its original identity, never the new account's state or UI. |

## Handoff and verification

The existing throwaway prototype is not conformant evidence for this specification. It currently lacks typed variables, escaping, required-value checks, and output bounds; its copy/retry and concurrent-change paths also need replacement during production work. Do not silently reinterpret its current in-memory behavior as this contract.

Production implementation must turn the acceptance examples into shared parser/validation conformance cases and exercise web and desktop interaction, clipboard failure, usage persistence failure, account transitions, and in-flight races at agreed public test seams. Existing performance, keyboard, screen-reader, offline, and supported-platform release requirements still apply. Measure the existing 150 ms copy target from final Copy activation after human input, including validation/substitution and clipboard confirmation; human typing time is excluded. Test at the accepted size limits and with many variables, rather than validating only a tiny happy path.

This documentation task adds no runtime behavior or implementation tests. The user confirmed the consolidated decision and authorized its publication and closure of #21. The separate readiness issue #12 remains open for its full-specification decision. Standards and Spec reviews have no unresolved findings. Oxfmt formatting and Git whitespace checks passed; the existing typecheck and full workspace test commands passed using Turbo's cached results. Those existing tests do not validate this newly specified behavior.
