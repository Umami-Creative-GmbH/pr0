# Rehearse desktop updates through an audience-scoped manifest on the live update endpoint

Every official desktop build compiles in one update endpoint for its whole life, so a candidate tested against any other endpoint is not the build we ship, and once real users poll the endpoint, a candidate can't be offered there for validation either. We therefore validate every release, starting with the MVP, through a **rehearsal manifest**: the operator's proxy serves the official endpoint's update metadata from the rehearsal manifest only to allowlisted tester addresses (an IPv4 address or an IPv6 /64) and from the **live manifest** to everyone else. Installed predecessors get updated to the candidate with exactly the bytes we ship, and nothing unvalidated reaches the public. The MVP release candidate is the predecessor in its own update rehearsal. Its rehearsal target is the next patch version, built from the same commit with only the version changed, signed with the official updater key, and never published. For the first candidate that means 0.1.0 and 0.1.1.

**Amendment (hosted-launch grilling, 2026-11-10):** Versions are never reused, even when a candidate fails. Every new candidate gets the next unused version, and its rehearsal target the version after it. If 0.1.0 and its target 0.1.1 fail, the next pair is 0.1.2 and 0.1.3. The MVP is released as whichever version first passes every gate. Elsewhere, "0.1.0" means that first released MVP version. Reserved rehearsal versions are recorded in the repository, not hard-coded, and both release workflows refuse them for public release.

## Considered options

- **Deleting a failed candidate's draft and tag to rebuild the same version**: rejected. Tags never move, and a version never names different bytes, even if no user saw the first bytes. A version number costs nothing; immutability does.
- **A separate rehearsal endpoint compiled into test builds**: rejected. The tested bytes would differ from the shipped bytes, and the shipped binary's own update path would never be exercised.
- **Using the live endpoint before launch only**: rejected. It works once and offers nothing for any release after the first users exist.
- **An in-app opt-in test channel**: rejected for the MVP. It adds user-visible scope and code paths that the approved spec doesn't contain.

## Consequences

- The rehearsal manifest and the rehearsal-only installers and signatures are served only to the allowlist. Rehearsal artifacts are not publicly downloadable, even though they are unlisted. They never enter the live channel image, a GitHub Release or a draft release. A separate private rehearsal channel serves them, and the edge proxy routes all `/update` traffic from allowlisted client addresses to it, ahead of the live channel. Deleting that route and resource after the rehearsal is how the rehearsal rules are removed.
- To avoid burning versions on candidates that later fail, the rehearsal target is built only after the candidate has passed every installed and automated check that doesn't depend on the rehearsal. The final candidate audit then cites the rehearsal's evidence.
- A version number is consumed once its bytes are uploaded to the update host or installed outside a disposable test machine. It never identifies different bytes afterwards. A rehearsal target's version is consumed even though it is never released.
- Testers must reach the endpoint from an allowlisted address, without an intervening proxy or VPN that changes the source address. The updater honors the system proxy.
- Until the first public release, the live manifest offers no update (HTTP 204). Afterwards it names the newest released version.
- Update metadata and artifacts are served as static files by the proxy itself, independently of the hosted service's application, so maintenance or an outage of the hosted service doesn't stop updates. Rehearsal rules are part of the release runbook and must be removed from, or confirmed absent in, the proxy configuration after each rehearsal.
