# The desktop trusts the Windows certificate store for instance connections

The desktop's connection to the selected instance validated server certificates only against Mozilla's root certificates bundled into the binary, while the user's browser and our own updater trust the Windows certificate store. As a result, desktop sign-in and sync failed on networks that inspect TLS and against self-hosted instances using a private or internal certificate authority, even though the web app worked in both cases. Starting with the MVP release candidate, we validate instance certificates against the Windows certificate store, so "trusted HTTPS" means trusted by the user's Windows. HTTPS-only connections, refused redirects and binding to the selected origin stay in place.

## Considered options

- **Keeping bundled public roots and requiring a publicly trusted certificate**: rejected. It protects nothing beyond what an attacker who can already add roots to the user's Windows store has, it silently excludes legitimate company and self-hosted setups, and it would make the desktop disagree with the browser on the same machine.

## Consequences

- This is a compatibility commitment. Once released versions accept roots the user's Windows trusts, narrowing that trust later would cut off users who rely on it.
- An untrusted certificate must still fail closed, preserving local work and pending changes, and the failure must be distinguishable from being offline.
- The decision covers only the official desktop's choice of trust anchors. It doesn't change how update signatures are trusted, which remains independent of any certificate authority (ADR-0001).
