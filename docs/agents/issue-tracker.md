# Issue tracker: GitHub

Issues and specs live in GitHub Issues for Umami-Creative-GmbH/pr0. Use the gh CLI from this repository; it infers the repository from origin.

## Operations

- Create: gh issue create --title "..." --body-file <path>
- Read: gh issue view <number> --comments
- Inspect metadata: gh issue view <number> --json number,title,body,labels,comments
- List: gh issue list --state open --json number,title,body,labels
- Comment: gh issue comment <number> --body-file <path>
- Add labels: gh issue edit <number> --add-label "<label>"
- Remove labels: gh issue edit <number> --remove-label "<label>"
- Close: gh issue close <number>

Write multiline bodies to a UTF-8 file and pass --body-file. Apply the vocabulary in docs/agents/triage-labels.md.

When a skill says "publish to the issue tracker", create a GitHub issue. When it says "fetch the relevant ticket", read the issue and its comments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares issue and PR numbers. If a reference is ambiguous, resolve its type before choosing issue or PR commands.
