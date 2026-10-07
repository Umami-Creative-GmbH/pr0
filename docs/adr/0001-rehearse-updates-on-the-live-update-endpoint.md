# Rehearse desktop updates through an audience-scoped manifest on the live update endpoint

Every official desktop build compiles in one update endpoint for its whole life, so a candidate tested against any other endpoint is not the build we ship, and once real users poll the endpoint, a candidate can't be offered there for validation either. We therefore validate every release, starting with the MVP, through a **rehearsal manifest**: the operator's proxy serves the official endpoint's update metadata from the rehearsal manifest only to allowlisted tester addresses (an IPv4 address or an IPv6 /64) and from the **live manifest** to everyone else. Installed predecessors get updated to the candidate with exactly the bytes we ship, and nothing unvalidated reaches the public. The MVP release (0.1.0) is the predecessor in its own update rehearsal. Its rehearsal target (0.1.1) is built from the same commit with only the version changed, is signed with the official updater key, and is never published, so the next real release starts at 0.1.2.

## Considered options

- **A separate rehearsal endpoint compiled into test builds**: rejected. The tested bytes would differ from the shipped bytes, and the shipped binary's own update path would never be exercised.
- **Using the live endpoint before launch only**: rejected. It works once and offers nothing for any release after the first users exist.
- **An in-app opt-in test channel**: rejected for the MVP. It adds user-visible scope and code paths that the approved spec doesn't contain.

## Consequences

- The rehearsal manifest and the rehearsal-only installers and signatures are served only to the allowlist. Rehearsal artifacts are not publicly downloadable, even though they are unlisted.
- A version number is consumed once its bytes are uploaded to the update host or installed outside a disposable test machine. It never identifies different bytes afterwards. A rehearsal target's version is consumed even though it is never released.
- Testers must reach the endpoint from an allowlisted address, without an intervening proxy or VPN that changes the source address. The updater honors the system proxy.
- Until the first public release, the live manifest offers no update (HTTP 204). Afterwards it names the newest released version.
- Update metadata and artifacts are served as static files by the proxy itself, independently of the hosted service's application, so maintenance or an outage of the hosted service doesn't stop updates. Rehearsal rules are part of the release runbook and must be removed from, or confirmed absent in, the proxy configuration after each rehearsal.
