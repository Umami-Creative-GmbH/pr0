# Run from the repository root on the operator's Windows signing host.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$requiredNames = @('PR0_UPDATE_PUBLIC_KEY', 'PR0_UPDATE_ENDPOINT', 'TAURI_SIGNING_PRIVATE_KEY', 'PR0_AUTHENTICODE_THUMBPRINT', 'PR0_TIMESTAMP_URL')
foreach ($releaseName in $requiredNames) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($releaseName))) {
        throw "Release blocked: configure $releaseName on the operator signing host. Unsigned builds are not releases."
    }
}
$endpoint = [Uri]$env:PR0_UPDATE_ENDPOINT
if ($endpoint.Scheme -ne 'https' -or $endpoint.UserInfo -ne '') { throw 'Update endpoint must be HTTPS without credentials.' }
$timestamp = [Uri]$env:PR0_TIMESTAMP_URL
if ($timestamp.Scheme -ne 'https') { throw 'Timestamp service must use HTTPS.' }
$repoDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$nativeDirectory = Join-Path $PSScriptRoot 'src-tauri'
$releaseConfig = Join-Path $nativeDirectory 'target/release-signing.json'
$baseConfig = Get-Content -LiteralPath (Join-Path $nativeDirectory 'tauri.conf.json') -Raw | ConvertFrom-Json
$version = $baseConfig.version
New-Item -ItemType Directory -Force -Path (Split-Path $releaseConfig) | Out-Null
@{
    bundle = @{
        createUpdaterArtifacts = $true
        windows = @{
            certificateThumbprint = $env:PR0_AUTHENTICODE_THUMBPRINT
            digestAlgorithm = 'sha256'
            timestampUrl = $env:PR0_TIMESTAMP_URL
            tsp = $true
        }
    }
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $releaseConfig -Encoding utf8

Push-Location $repoDirectory
try {
    & bun run --cwd apps/desktop tauri build --target x86_64-pc-windows-msvc --bundles nsis --config $releaseConfig
    if ($LASTEXITCODE -ne 0) { throw 'Signed desktop build failed.' }
    $bundleDirectory = Join-Path $nativeDirectory 'target/x86_64-pc-windows-msvc/release/bundle/nsis'
    $installer = Join-Path $bundleDirectory "pr0_${version}_x64-setup.exe"
    $binary = Join-Path $nativeDirectory 'target/x86_64-pc-windows-msvc/release/pr0-desktop.exe'
    foreach ($signedPath in @($binary, $installer)) {
        $signature = Get-AuthenticodeSignature -LiteralPath $signedPath
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $env:PR0_AUTHENTICODE_THUMBPRINT -or $null -eq $signature.TimeStamperCertificate) {
            throw "Authenticode or timestamp verification failed: $signedPath"
        }
    }
    & cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --example verify_update_signature -- $installer "$installer.sig" $version
    if ($LASTEXITCODE -ne 0) { throw 'Independent updater signature verification failed.' }
    $evidence = @{
        version = $version
        installer = (Split-Path $installer -Leaf)
        sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
        authenticode = 'Valid'
        updaterSignature = 'Verified with signed version'
        timestamp = [DateTime]::UtcNow.ToString('o')
        installedJourneys = 'NOT RUN: retain current/prior-version and failure evidence before publishing'
    }
    $evidence | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundleDirectory 'signing-evidence.json') -Encoding utf8
    Write-Output "Signed artifacts verified in $bundleDirectory. Complete installed validation before publishing."
} finally {
    Pop-Location
}
