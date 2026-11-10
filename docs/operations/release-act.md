# Release act

This runbook takes a release from the **candidate freeze** to a completed **release act**: the moment the GitHub Release is public, the live manifest names the version with matching hashes and the hosted service opens public registration. [ADR-0002](../adr/0002-mvp-release-requires-verified-candidate-and-hosted-launch.md) defines the two gates and the order, [ADR-0001](../adr/0001-rehearse-updates-on-the-live-update-endpoint.md) (2026-11-10 amendment) the versions and the rehearsal. Terms follow `CONTEXT.md`.

Steps marked **[H]** are human only: an agent never approves a signing run, publishes a release, changes registration on the hosted service or closes a gate issue. Steps marked **[A]** may be prepared by an agent. Every command checks TLS certificates; never add `--insecure`, `-k`, `--ssl-no-revoke` or a certificate-skipping option to any of them. If a command fails on a certificate, stop and fix the certificate.

The PowerShell commands run on a supported Windows client from a repository checkout with `gh` signed in. The shell commands run on the app host. Set these once per PowerShell session:

```powershell
$version = '0.1.0'          # the candidate version, never a reserved rehearsal version
$tag = "v$version"
$installer = "pr0_${version}_x64-setup.exe"
$work = Join-Path $env:TEMP "pr0-release-act-$version"
New-Item -ItemType Directory -Force $work | Out-Null
```

## 1. Build a candidate

1. **[A]** Bump the desktop package, Tauri and Cargo versions to the next unused version and reserve its rehearsal target in the same reviewed change, as the [version policy](update-channel.md#version-policy) describes. The candidate commit must contain every pre-freeze change. Finish the draft's release notes later with the release date, protocol/normalization pair and local schema ([compatible upgrades](compatible-upgrades.md)).
2. **[A]** Create the annotated version tag on the merged commit and push it. Never move a tag or reuse a version.
3. **[A]** Start **Build desktop candidate** with the tag. **[H]** Approve the `desktop-signing` environment run. Nobody else approves it. The workflow refuses reserved versions and creates the draft release with the installer, its `.sig` and `signing-evidence.json` ([Publish a version](update-channel.md#publish-a-version), step 1).
4. **[A]** Record the candidate identity on the candidate's issue and on #64, #112 and #66:

   ```powershell
   git fetch --tags origin
   git rev-parse "$tag^{commit}"
   gh release view $tag --json isDraft,assets --jq '{isDraft, assets: [.assets[].name]}'
   gh release download $tag --dir "$work\draft" --clobber
   $evidence = Get-Content "$work\draft\signing-evidence.json" -Raw | ConvertFrom-Json
   $evidence | Format-List version, installer, sha256, authenticode, updaterSignature
   if ((Get-FileHash "$work\draft\$installer").Hash -ne $evidence.sha256) { throw 'Draft installer does not match its signing evidence' }
   ```

   `isDraft` must be `true` and the assets must be exactly the installer, `.sig` and `signing-evidence.json`.

Any later failure in #64, #112 or #66 spends this version. Start again at step 1 with the next unused version and its rehearsal target. Never delete, rebuild or publish the failed draft.

## 2. Redeploy the candidate's server

**[H]** On the app host, redeploy the candidate commit with the operator script, as the hosted runbook's [Redeploy a candidate](hosted.md#redeploy-a-candidate) section describes. ADR-0002 is strict: every new candidate is redeployed, even one with only desktop changes. The script checks that a fresh verified backup and enough scratch space exist, closes ingress, builds the app and tools images with matching tags, runs one migration, replays deletions, recreates web and mail, runs the authenticated checks and readiness, makes a verified backup and reopens ingress. It stops at the first failed step with ingress closed and data intact.

Keep the deployment record the script writes (deployed commit, image identities and step timings) and the deploy time. The redeploy counts as maintenance in the **burn-in** and doesn't restart it. The final candidate's server must run for at least the last 24 hours of the burn-in window, so redeploy it at least 24 hours before the window ends.

## 3. Rehearse the update and tear the rehearsal down

Start only after the candidate has passed every installed and automated check that doesn't depend on the rehearsal (#64), so that versions aren't spent on a candidate that was going to fail anyway.

1. **[A]** Run **Build rehearsal target** with the candidate's reserved rehearsal version from [`reserved-rehearsal-versions.json`](../../infrastructure/update-channel/reserved-rehearsal-versions.json). **[H]** Approve its two `desktop-signing` jobs. See [Build a rehearsal target](update-channel.md#build-a-rehearsal-target).
2. **[A]** Run **Package rehearsal channel** with that version and the build's run ID. **[H]** Approve the `rehearsal-channel` environment. See [Package a target](update-channel.md#package-a-target). The [one-time setup](update-channel.md#one-time-setup) must be done first.
3. **[H]** Collect the testers' addresses under the [tester requirements](update-channel.md#tester-requirements), create the Coolify rehearsal resource with its router labels ([Route tester addresses to the rehearsal channel](update-channel.md#route-tester-addresses-to-the-rehearsal-channel)) and record the tester and non-tester output from [Verify the routing](update-channel.md#verify-the-routing).
4. **[H]** Run #112 from the installed candidate to its rehearsal target.
5. **[H]** [Tear down](update-channel.md#tear-down) the rehearsal resource whether #112 passed or failed. Record the deletion time, the empty `docker ps` output and the `curl.exe` output from a former tester's address.

## 4. Write the go/no-go record

**[H]** Write the record when both gates have passed: #66 has audited this candidate and the hosted launch gate (#135) has passed for it. The burn-in window must end no more than 24 hours before the release act. If the act slips, run the burn-in report again with a later start minute ([Burn-in report](probe-host.md#burn-in-report)).

Immediately before posting, check the live manifest anonymously from a client that isn't a tester address:

```powershell
curl.exe --silent --show-error --dump-header - --output NUL https://pr0.umami-creative.app/update/
```

Expect status 204, and no `Location`, `Set-Cookie` or `X-Pr0-Update-Channel` header. Also check the draft once more with the commands in [section 1, step 4](#1-build-a-candidate). Then post the record on #23 with `gh issue comment 23 --body-file <file>`, using this template. Every line needs a value or a link; a line that can't be filled is a no-go. Redact addresses, emails and secrets.

```markdown
## Go/no-go record: pr0 <version>

Decision: GO / NO-GO, by <name>, <UTC time>

### Candidate identity

- Version and tag: <version>, `v<version>` (draft release: <link>)
- Installer SHA-256: <hash from signing-evidence.json>
- Server commit: <full commit>; it is also the tag's commit
- Rehearsal target: <reserved version>, installer SHA-256 <hash>, build run <link>

### Release candidate gate (ADR-0002)

- [ ] #66 audit of this installer and server commit: <link>
- [ ] #64 installed matrix on this draft candidate, citing #112 for the signed-update cases: <link>
- [ ] #112 rehearsal from this candidate to its rehearsal target: <link>
- [ ] Rehearsal routing evidence, tester and non-tester (redacted): <link>
- [ ] Rehearsal teardown: deletion time, empty `docker ps`, former-tester `curl.exe` output: <link>
- [ ] #59, #62, #63, #64 and #65 closed: <links>
- [ ] Draft assets are exactly the installer, `.sig` and `signing-evidence.json`, and the installer hash matches the evidence: <output>
- [ ] Draft release notes include the release date, protocol/normalization pair and local schema

### Hosted launch gate (#120, record on #135)

- [ ] 1. The hosted service runs exactly this server commit behind trusted TLS; redeployed with the operator script at <UTC time>: <deployment record>
- [ ] 2. Authenticated ingress attributes clients and forged headers can't create buckets: <link>
- [ ] 3. Production email delivered: verification, recovery, email change, notice to the old address: <link>
- [ ] 4. Google and GitHub sign-up, sign-in, linking and desktop device approval on the hosted origin: <link>
- [ ] 5. Encrypted off-server backups running and verified; key retrieved from a second machine: <link>
- [ ] 6. Both independent deletion ledgers in operation and reporting capacity: <link>
- [ ] 7. Pre-release restore rehearsal passed in place with measured timings; test accounts deleted: <link>
- [ ] 8. Update metadata served statically; live manifest answers 204 (fresh check below)
- [ ] 9. External probe and alert delivery from a separate host; deliberate-failure test; dead-man's switch active: <link>
- [ ] 10. Legal pages published and linked; processor agreements signed; record of processing activities exists: <link>
- [ ] 11. Burn-in passed (see below)

### Burn-in report

- Command: `bun run --cwd apps/web availability burn-in <start minute> <files>`
- Window: <start> to <end> (UTC), ending <hours> before the planned release act (at most 24)
- Output: <JSON, with `complete: true` and `targetMet: true`>
- Evidence file SHA-256: <hashes>
- Candidate deployments in the window: <UTC times>; the final candidate ran for the last <hours> (at least 24)

### Fresh live manifest check

- Time (UTC): <time>
- Output: <`curl.exe` headers showing 204, no `Set-Cookie`, no `X-Pr0-Update-Channel`>
```

Go only if every box is checked. A no-go names the failed line and its next step: a candidate failure spends the version (back to [section 1](#1-build-a-candidate)), a hosted failure is fixed on the hosted service.

## 5. Perform the release act

Run these steps in this order, without a break, within 24 hours of the burn-in window's end. Registration opens last.

### 5.1 Publish the draft

**[H]** Publish the draft release, on GitHub or with:

```powershell
gh release edit $tag --draft=false
```

This makes the download public and starts **Publish update channel**. From now on the release is never unpublished: no draft again, no deletion, no tag change. If anything below fails, follow [Fix forward](#fix-forward).

### 5.2 Confirm the workflow and the Coolify deployment

**[H]** Wait for the workflow run that the publication started and check that it succeeded:

```powershell
gh run list --workflow update-channel.yml --event release --limit 1
gh run watch <run-id> --exit-status
```

Then, in Coolify, open the live update-channel resource (image `ghcr.io/umami-creative-gmbh/pr0-updates`) and check that the deployment the run started finished successfully. A queued webhook response alone doesn't prove it.

### 5.3 Confirm the live manifest names the version

```powershell
curl.exe --silent --show-error --dump-header - https://pr0.umami-creative.app/update/
$manifest = curl.exe --fail --silent --show-error https://pr0.umami-creative.app/update/ | ConvertFrom-Json
$windows = $manifest.platforms.'windows-x86_64'
if ($manifest.version -ne $version) { throw "Live manifest names $($manifest.version)" }
if ($windows.url -ne "https://pr0.umami-creative.app/update/releases/$version/$installer") { throw "Unexpected installer URL $($windows.url)" }
```

Expect status 200, `Content-Type: application/json`, `Cache-Control: no-store`, no `Set-Cookie` and no `X-Pr0-Update-Channel` header.

### 5.4 Confirm the hashes

Download the files from the update channel and from the public GitHub Release, and compare them with the draft's files from [section 1](#1-build-a-candidate) and the hash in the go/no-go record:

```powershell
$expected = '<installer SHA-256 from the go/no-go record>'
$channel = "https://pr0.umami-creative.app/update/releases/$version"
$github = "https://github.com/Umami-Creative-GmbH/pr0/releases/download/$tag"
New-Item -ItemType Directory -Force "$work\channel", "$work\github" | Out-Null
foreach ($file in $installer, "$installer.sig", 'signing-evidence.json') {
  curl.exe --fail --silent --show-error --output "$work\channel\$file" "$channel/$file"
  curl.exe --fail --silent --show-error --location --output "$work\github\$file" "$github/$file"
}
$signature = (Get-FileHash "$work\draft\$installer.sig").Hash
foreach ($source in 'channel', 'github') {
  if ((Get-FileHash "$work\$source\$installer").Hash -ne $expected) { throw "$source installer differs from the signing evidence" }
  if ((Get-FileHash "$work\$source\$installer.sig").Hash -ne $signature) { throw "$source signature differs from the signed draft" }
  if ((Get-Content "$work\$source\signing-evidence.json" -Raw | ConvertFrom-Json).sha256 -ne $expected) { throw "$source signing evidence names another installer" }
}
if ($windows.signature -cne (Get-Content "$work\channel\$installer.sig" -Raw).Trim()) { throw 'Manifest signature differs from the .sig file' }
Get-FileHash "$work\draft\*", "$work\channel\*", "$work\github\*" | Format-Table Hash, Path
```

Then verify the downloaded signature independently with the official public key (not a secret):

```powershell
$env:PR0_UPDATE_PUBLIC_KEY = '<base64 updater public key>'
cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --example verify_update_signature -- "$work\channel\$installer" "$work\channel\$installer.sig" $version
```

Expect `Updater signature and release version verified`. Keep every command's output for #111.

### 5.5 Open registration

**[H]** Only after 5.2 to 5.4 have passed, switch registration to `open` on the app host. Use the maintenance lock that the backup timer and the operator script share:

```sh
cd /opt/pr0
sed -i 's/^PR0_REGISTRATION=allowlist$/PR0_REGISTRATION=open/' .env
grep '^PR0_REGISTRATION=' .env
flock --wait 1800 /run/lock/pr0-maintenance.lock docker compose up -d --force-recreate --wait web mail
docker compose exec web printenv PR0_REGISTRATION
docker compose exec mail printenv PR0_REGISTRATION
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://pr0.umami-creative.app/api/v1/ready
```

`grep` and both `printenv` commands must print `open`, and readiness must print `200`. Then, in a browser, sign up with a new email address that was never allowlisted, complete the verification email and sign in. Delete that account afterwards through the app. The release act is complete now: the download is public, the live manifest names the version with matching hashes, and registration is open.

## Fix forward

A release is never unpublished, its tag never moves and its version never names other bytes. Registration stays `allowlist` until every check in 5.2 to 5.4 passes.

| What failed | What to do |
| --- | --- |
| **Publish update channel** failed | Fix the cause on `main` (or the environment's secrets), then run **Publish update channel** from Actions with **bootstrap** disabled. It rereads every published release, including this one. |
| Image published, Coolify deployment failed | Fix Coolify and redeploy `latest` on the live update-channel resource. Don't rebuild the candidate. |
| Manifest names an older version or none | Check that the run picked up the release and that Coolify runs the new image, then rerun the matching step above. |
| A hash or signature check failed | Stop. If the channel serves other bytes than GitHub, fix the channel and redeploy. If the GitHub Release's own files don't match the signing evidence, the version is spent: leave the release published, say so in its notes, keep registration on `allowlist`, and take the next candidate version through every gate. |
| Registration recreate failed | Fix web or mail and recreate them again. The release stays public while registration is not yet open. |

Record each failure and its fix on #23 and #111. The release act is complete only once all three outcomes hold.

## Record and close

**[H]** After the release act:

1. Record the evidence on #111 (the live manifest output from 5.3, the hash comparison and the independent verification from 5.4, the workflow run and Coolify deployment), then close #111.
2. Close #112 and #66 if their own criteria are met.
3. Record the release act on #23: the publication time, the workflow run, the manifest output, the hash results and the registration switch time. Then close #23 and #136. Close #120 once all its tickets are closed.
4. Create two dated follow-up issues with the `ready-for-human` label:
   - **Monthly availability report** for the first full UTC month after the release act, due in the first days of the month after it ([Evidence rotation](probe-host.md#evidence-rotation)). A missed month starts an incident review, never a withdrawal.
   - **Quarterly restore rehearsal**, due three months after the pre-release restore rehearsal (#131), following [backup and restore](backup-restore.md).
5. Keep the private rehearsal package and the evidence. Recurring duties continue as documented: [secret rotation](probe-host.md#secret-rotation) and [session renewal](probe-host.md#session-renewal).
