# Prompt summary excerpts

REST and native list/search summaries include a required `excerpt`. Full prompt records and synchronization payloads retain their existing content contract.

`src/excerpt-rule.json` defines the shared limit and the pinned Unicode White_Space set. Both adapters collapse runs to one ASCII space, remove leading/trailing spaces, take the first 140 Unicode code points, and remove a trailing space at the cut. They append no ellipsis. Case, punctuation, markup and prompt variables remain literal text. The UI renders the excerpt as a text node.

Web and desktop cache excerpts with their derived search summaries. Content edits regenerate them; metadata-only updates preserve them. Derived index version changes rebuild existing summaries, including downloaded desktop libraries while offline. No new canonical data or synchronization field is required.
