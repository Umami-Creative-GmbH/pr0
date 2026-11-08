# Automated update channel on Coolify

GitHub Actions builds signed Windows candidates into draft GitHub Releases. After installed validation and the release gates pass, Kai publishes the draft. A second workflow verifies those exact release assets, packages them into an Nginx image on GHCR, and triggers Coolify to pull and deploy it. Releases require no SSH uploads, host directory preparation, persistent release volume or manual manifest edits.

The image contains the live manifest and every previously packaged public installer, signature and signing evidence. Each build copies the preceding channel image's files before adding releases; changed bytes for an existing version fail the build. History is retained even if an older GitHub Release is removed. This exceeds the required 90-day predecessor retention window. Preserve the registry package and its image history; losing both the preceding image and GitHub assets loses the distribution archive.

## One time GitHub setup

Merge this change into the default branch before using its workflows. The **Build desktop candidate** workflow also requires the signed release tooling from [PR #104](https://github.com/Umami-Creative-GmbH/pr0/pull/104) in the version tag being built; that tooling is not part of this change. Use the existing signing pair from #106/#107. No paid Windows signing certificate is needed.

Create two GitHub Actions environments:

| Environment | Secrets |
| --- | --- |
| `desktop-signing` | `PR0_UPDATE_PUBLIC_KEY`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when applicable |
| `update-channel` | `PR0_UPDATE_PUBLIC_KEY`, and later `COOLIFY_DEPLOY_WEBHOOK` and `COOLIFY_TOKEN` |

Use the full base64 Tauri public-key file contents for `PR0_UPDATE_PUBLIC_KEY`. On a GitHub-hosted runner, the private-key secret must contain the key contents, not a path on your PC. Keep the signing environment restricted to trusted operators and refs. The workflow fixes the official update endpoint and default instance URL. The update-image workflow receives only the public key, never the signing key.

The image workflow uses `GITHUB_TOKEN` with package-write permission to publish `ghcr.io/umami-creative-gmbh/pr0-updates`. It creates a unique `run-<id>-<attempt>` tag and updates `latest`. See [GitHub container publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).

Each tag includes both `linux/amd64` and `linux/arm64`, so x64 and ARM64 Coolify hosts pull their native Nginx image automatically. The packaged Windows installer remains Windows x64. The image build only copies configuration and verified release files into the matching Nginx base image; it does not execute foreign-architecture build commands. CI builds both variants, and publication verifies both platform entries before calling Coolify.

Before publishing any desktop release, run **Publish update channel** from Actions with **bootstrap** enabled. With no releases, it creates an image whose `/update/` endpoint returns HTTP 204. Leave the Coolify secrets unset for this first run; the workflow reports that it published without deployment. Bootstrap is only for the initial empty channel. Later builds must retrieve `latest` successfully, otherwise they stop rather than drop old artifacts.

## One time Coolify setup

1. Create a separate **Docker Image** application, replacing the earlier Compose-based resource. Set image to `ghcr.io/umami-creative-gmbh/pr0-updates`, tag to `latest`, and exposed port to `8080`. If the GHCR package is private, configure registry pull credentials in Coolify first; alternatively make this release-assets-only package public.
2. Add HTTPS hostname `pr0.umami-creative.app`, internal port `8080`, and path `/update`. In interfaces with one URL field, use `https://pr0.umami-creative.app:8080/update`. Under **Advanced > Proxy**, choose **Keep paths as-is**. The main application retains its root route; the more specific update route goes to this container.
3. Remove the old `/data/pr0-updates` bind mount. Do not mount storage at `/srv/update` or its parents: a volume would hide newer files packaged in the image. This resource has no mutable application data and needs no persistent storage. A Docker Image resource exposes Coolify's ordinary storage editor if future features need another mount; Compose resources instead take mounts from their Compose definition.
4. Configure health checks for container port `8080`, path `/healthz` (without `/update`). The image already declares a health check. Deploy once and confirm `/update/` returns HTTP 204 over trusted HTTPS without authentication.
5. Enable Coolify API access, create a deploy-only API token, and copy this application's authenticated **Deploy Webhook** from **Webhooks**. Store the token as `COOLIFY_TOKEN` and the HTTPS webhook URL as `COOLIFY_DEPLOY_WEBHOOK` in the GitHub `update-channel` environment. Subsequent image publications call that webhook automatically. No Git push auto-deployment is needed for this image resource.

Coolify pulls the current `latest` image on redeploy; it does not itself watch GHCR for new images. The workflow sends an authenticated POST to the deploy webhook; current Coolify API routes reject GET with HTTP 405. A queued webhook response proves only that Coolify accepted the request; check its deployment result. See [Docker Image deployment](https://coolify.io/docs/applications/deployments/docker-image), [deploy webhooks](https://coolify.io/docs/core/automation/deploy-webhooks), [API routes](https://github.com/coollabsio/coolify/blob/main/routes/api.php), [domain routing](https://coolify.io/docs/core/networking/domains), and [storage ownership](https://coolify.io/docs/applications/configuration/persistent-storage).

## Publish a version

1. Update the desktop package, Tauri and Cargo versions consistently and create the matching version tag, for example `v0.1.0`. The tag must contain both workflows' required release tooling. Run **Build desktop candidate** with that tag. It runs repository checks and native tests, signs the Windows x64 NSIS installer, verifies its updater signature, and creates a draft release containing the installer, its `.sig` and `signing-evidence.json`. It refuses a tag that already has a release. Never rebuild a consumed version with different bytes.
2. Download and validate that exact draft candidate on supported Windows, retaining evidence for #112 and the release gates in [ADR-0002](../adr/0002-mvp-release-requires-verified-candidate-and-hosted-launch.md). A successful runner build does not satisfy installed validation. Finish the release notes on the draft.
3. **Publish the draft release.** This is the human release action. The update workflow excludes drafts and prereleases, downloads published assets, checks evidence hashes, independently verifies updater signatures and signed versions using Minisign, and makes the highest public version live. It retains earlier files and refuses an accidental manifest downgrade. GitHub's public download and Coolify activation are asynchronous; inspect both workflow and deployment results.

The generated public layout is unchanged:

```text
https://pr0.umami-creative.app/update/
https://pr0.umami-creative.app/update/releases/0.1.0/pr0_0.1.0_x64-setup.exe
https://pr0.umami-creative.app/update/releases/0.1.0/pr0_0.1.0_x64-setup.exe.sig
https://pr0.umami-creative.app/update/releases/0.1.0/signing-evidence.json
```

The manifest responds with `application/json` and `Cache-Control: no-store`. It embeds the actual signature file contents. No signing secrets, source checkout, draft assets or dependency toolchains are copied into the final image. Only the Nginx config and prepared channel files are included. The service remains independent of the hosted web app and its database.

Rehearsal targets must remain private. Version 0.1.1 is permanently reserved for the MVP rehearsal and is rejected by both workflows. This change does not implement ADR-0001's tester address allowlist or protected rehearsal artifact route; add that before installed update rehearsals. Never publish a rehearsal draft to work around this requirement.

If image publication succeeds but Coolify deployment fails, fix the deployment issue and redeploy `latest` in Coolify; do not rebuild the Windows candidate. To iterate on the channel image/configuration, merge the change and rerun **Publish update channel** with bootstrap disabled. Existing release assets are reused and reverified. Withdrawal of a live release needs a separate reviewed manifest operation; this workflow will not silently downgrade or erase a feed when a GitHub release disappears.

## Verification

From a supported Windows client:

```powershell
curl.exe --silent --show-error --dump-header - --output NUL https://pr0.umami-creative.app/update/
```

Expect HTTP 204 before the first release, or HTTP 200 JSON afterwards, with no login redirect or cookies. Do not bypass certificate verification. Record public HTTPS results and downloaded installer verification on [issue #111](https://github.com/Umami-Creative-GmbH/pr0/issues/111); automated packaging alone does not close it.

For development, install Minisign (or set `MINISIGN_PATH` to its executable) and run `bun run test:update-channel`. The tests generate disposable signing keys and exercise the packaging boundary, including bad hashes/signatures, signed-version mismatch, retained predecessors and immutable files. CI runs this on Linux. `bun run typecheck` includes the packaging workspace. Build an empty local image with `docker build -t pr0-update-channel infrastructure/update-channel`; run it with `docker run --rm -p 127.0.0.1:8080:8080 pr0-update-channel`.
