# The MVP is released by one human release act, after both the candidate and the hosted launch pass

The MVP implementation spec (#23) excludes provisioning and rollout of the hosted service. Yet the official desktop app preselects the hosted service as its server, and the official update channel shares its host, so a verified application whose default server can't be reached hasn't been released. We therefore define the MVP as **released** at the **release act**: the irreversible human step in which the live manifest first names 0.1.0 and the public download (GitHub Release `v0.1.0`) exists. The release act is allowed only after two independent gates pass: the **release candidate gate** (#66's audit of one identified desktop installer and server commit, with #59, #62, #63, #64 and #65 closed) and the **hosted launch gate**, which a separate hosted-launch spec owns rather than #23.

## Consequences

- The hosted launch gate requires the hosted service to run exactly the candidate's server commit behind trusted TLS, with production email delivery and Google/GitHub sign-in verified end to end, encrypted off-server backups and the independent deletion ledger in operation, a pre-release restore rehearsal on the hosted configuration, update metadata served statically with the live manifest answering 204, and the external availability probe with alert delivery running from a separate host.
- Hosted availability (99.5% per month, measured externally) is an operating objective, not a release blocker, consistent with #23's list of release blockers. Before the release act, the probe must show a burn-in of at least seven consecutive days at or above 99.5%. Monthly reports begin with the first full UTC month after release, and a missed month triggers an incident review, never a withdrawal of the release.
- #66 stays an audit of the application candidate. For hosted availability (story 84) it cites the hosted launch gate's evidence instead of producing its own.
- A self-hosted server is versioned by the annotated tag `v0.1.0` and built from source with the repository's Compose file. No registry images are published for the MVP. The GitHub Release is the official download page and attaches the same verified installer, signature and signing evidence as the official update channel, with matching hashes.
- #23 closes only once the release act is recorded.

## Considered options

- **Treating the hosted launch as separate work entirely**: rejected, because the shipped desktop would preselect a server that doesn't work.
- **Folding hosted provisioning into #23, #66 or #111**: rejected, because #23 deliberately keeps the application operator-neutral, and provisioning work is mostly human operator tasks with their own evidence.
- **A full month of measured availability before release**: rejected, because it adds at least 30 days to the critical path for an objective #23 doesn't treat as a release blocker.
