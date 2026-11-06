# Update channel on Coolify

The update channel runs as a separate Nginx container built from this repository. It serves static files without the web application, database, account cookies or signing credentials. Coolify terminates HTTPS. An empty storage directory makes `/update/` return HTTP 204, as required before the first public release.

## Deploy

1. On the Linux deployment host, create the persistent upload directory:

   ```sh
   sudo mkdir -p /data/pr0-updates/releases
   sudo chmod 755 /data/pr0-updates /data/pr0-updates/releases
   ```

2. In Coolify, create a separate application from this Git repository using **Docker Compose**. Select the branch containing this change. Set **Base Directory** to `/infrastructure/update-channel` and **Docker Compose Location** to `/compose.yaml`. Keep it separate from the hosted web application's deployment.
3. Add a domain for the `updates` service: HTTPS, hostname `pr0.umami-creative.app`, internal port `8080`, path `/update`. In interfaces with a single URL field, enter `https://pr0.umami-creative.app:8080/update`.
4. Under **Advanced > Proxy**, select **Keep paths as-is** for path prefixes. Nginx expects `/update/` and `/update/releases/...`, including that prefix. Review the generated proxy configuration to confirm there is no prefix-stripping middleware on this route.
5. Deploy. DNS must point to the Coolify host, with ports 80 and 443 reaching its proxy for automatic certificate issuance. Do not enable authentication middleware on the update route. If a domain-conflict warning appears because the main app uses the same hostname, retain its root route and give this service only the more specific `/update` route.

The container listens on port 8080 internally; it needs no public host-port mapping. Coolify's proxy selects this path over the main application's root route. Configure any Coolify health-check override to use container port 8080 and `/healthz`, without the public prefix. The Compose health check already uses that endpoint. See [Coolify domain routing](https://coolify.io/docs/core/networking/domains) and [Docker Compose builds](https://coolify.io/docs/applications/builds/docker-compose).

The bind mount is read-only inside the container and survives image rebuilds. Upload files to `/data/pr0-updates` on the deployment host over your existing SSH access; do not upload into the container or Git checkout. Make uploaded directories traversable and files readable by the container's `nginx` user (for example, directory mode 755 and file mode 644). Back up this directory independently. See [Coolify persistent storage](https://coolify.io/docs/core/persistent-storage/storage-mounts/overview).

## Verify the empty channel

From a supported Windows client, run:

```powershell
curl.exe --silent --show-error --dump-header - --output NUL https://pr0.umami-creative.app/update/
```

Expect HTTP 204 with `Cache-Control: no-store`, no login redirect and no cookies. Do not use `-k` or follow redirects to satisfy this check. Record the successful certificate validation and response headers on [issue #111](https://github.com/Umami-Creative-GmbH/pr0/issues/111). A running container alone does not verify public HTTPS.

## Upload a validated release

Only put validated public releases in `releases/`: every file below that directory is anonymously downloadable. Do not upload rehearsal targets or unvalidated candidates there. This initial image does not implement the source-address allowlist for rehearsals from [ADR-0001](../adr/0001-rehearse-updates-on-the-live-update-endpoint.md); add that routing and protected artifact storage before attempting an installed update rehearsal.

For a validated 0.1.0 release, the host directory will contain:

```text
/data/pr0-updates/
  live.json
  releases/
    0.1.0/
      pr0_0.1.0_x64-setup.exe
      pr0_0.1.0_x64-setup.exe.sig
      signing-evidence.json
```

Use the actual generated installer filename. Its public URL is `https://pr0.umami-creative.app/update/releases/0.1.0/pr0_0.1.0_x64-setup.exe`. Upload artifacts first, verify the downloaded installer against `signing-evidence.json`, and independently verify its signature with the official public key. Never upload private signing keys, passwords or `.env` files.

After all installed-validation and release gates pass, prepare the live manifest outside the public `releases/` directory:

```json
{
  "version": "0.1.0",
  "notes": "Initial release.",
  "platforms": {
    "windows-x86_64": {
      "url": "https://pr0.umami-creative.app/update/releases/0.1.0/pr0_0.1.0_x64-setup.exe",
      "signature": "REPLACE_WITH_THE_VERIFIED_SIG_FILE_CONTENTS"
    }
  }
}
```

Upload this as `/data/pr0-updates/live.json.next`, validate its JSON and exact version, URL and signature contents, and then atomically rename it to `live.json` on the same filesystem. This activates the live manifest immediately, without a redeploy. `/update/` returns HTTP 200 with `Content-Type: application/json` and `Cache-Control: no-store`; `live.json` is not available at a separate public URL. Nginx serves manifest bytes as supplied; it does not validate release eligibility, JSON or signatures.

Before the first release, leave `live.json` absent. During later releases retain the previous live manifest until the next release gate passes. Preserve immutable artifacts and evidence for supported predecessors under the 90-day retention policy. Do not overwrite a version with different bytes. Kai owns publication and the release act; this container does not automate either.

## Local container check

From the repository root:

```sh
docker build -t pr0-update-channel infrastructure/update-channel
docker run --rm -p 127.0.0.1:8080:8080 pr0-update-channel
```

`http://127.0.0.1:8080/healthz` returns 200 and `/update/` returns 204. Mount a disposable directory at `/srv/update:ro` to check manifests and release downloads. This local HTTP check does not replace the Windows HTTPS check against Coolify.
