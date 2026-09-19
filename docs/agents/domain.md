# Domain docs

## Layout

Use a single context shared across apps and packages:

- CONTEXT.md: domain glossary at the repository root.
- docs/adr/: architecture decision records.

## Before exploring

Read CONTEXT.md and ADRs relevant to the work. If CONTEXT-MAP.md exists after a future migration, follow its pointers to the relevant context documents and scoped ADRs.

If these documents are absent, proceed silently. The domain-modeling skill creates them when terminology or decisions are resolved.

## Vocabulary and decisions

Use the glossary's terms in issues, proposals, hypotheses, and tests. When a needed concept is missing, check existing terminology before identifying a gap for domain-modeling.

If a proposal contradicts an ADR, identify the decision and explain why it should be reconsidered.
