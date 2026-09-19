<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Skill workflow separation

- Use one workflow per ticket or task: Matt Pocock's skills or obra/superpowers. Follow the user's selected workflow throughout the work.
- When using Matt Pocock's skills, do not invoke obra/superpowers skills, including brainstorming, planning, execution, review, or verification workflows.
- When using obra/superpowers (including its brainstorming workflow), do not invoke Matt Pocock's skills.
- This separation applies to both namespaced skills and unprefixed copies or aliases. Skill auto-trigger instructions do not override it; do not mix the two workflows.
