# Windows QA-only, unsigned offline portable ZIP. Requires an already checked-out clean
# source ZIP created by package-windows.mjs. Downloads Node only on CI, NEVER on user PCs.
param(
  [Parameter(Mandatory = $true)][string]$SourceZip,
  [Parameter(Mandatory = $true)][string]$OutputDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Self-contained packaging requires a Windows runner.' }
$ver = (& node -p 'process.versions.node').Trim()
$arch = (& node -p 'process.arch').Trim()
if ($ver -notmatch '^24\.\d+\.\d+$' -or $arch -ne 'x64') {
  throw 'A Node 24 x64 runner is required; do not create packages for other architectures.'
}
$sourceFull = (Resolve-Path -LiteralPath $SourceZip).Path
if (-not (Test-Path -LiteralPath $OutputDir -PathType Container)) {
  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}
$outputFull = (Resolve-Path -LiteralPath $OutputDir).Path
$tempBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$temp = Join-Path $tempBase ('zhirox-node-stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp -Force | Out-Null
try {
  $filename = "node-v$ver-win-x64.zip"
  $url = "https://nodejs.org/dist/v$ver"
  $checksums = Join-Path $temp 'SHASUMS256.txt'
  $archive = Join-Path $temp $filename
  # HTTPS plus exact upstream SHA-256. Never trust a downloaded binary without a matching hash.
  Invoke-WebRequest -Uri "$url/SHASUMS256.txt" -OutFile $checksums -MaximumRedirection 3
  $found = @(Get-Content -LiteralPath $checksums | Where-Object {
    $_ -match ('^[a-fA-F0-9]{64}\s+' + [regex]::Escape($filename) + '$')
  })
  if ($found.Count -ne 1) { throw 'No unique official SHA256 for the requested Node archive.' }
  $expected = ($found[0] -split '\s+')[0].ToLowerInvariant()
  Invoke-WebRequest -Uri "$url/$filename" -OutFile $archive -MaximumRedirection 3
  $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($archiveHash -ne $expected) { throw 'Official Node archive checksum mismatch.' }

  $nodePath = Join-Path $temp 'node-upstream'
  $codePath = Join-Path $temp 'code'
  Expand-Archive -LiteralPath $archive -DestinationPath $nodePath
  Expand-Archive -LiteralPath $sourceFull -DestinationPath $codePath
  $upstream = Join-Path $nodePath "node-v$ver-win-x64"
  $app = Join-Path $codePath 'ZHIROX-HyperMarket-OS'
  if (-not (Test-Path -LiteralPath (Join-Path $upstream 'node.exe') -PathType Leaf)) {
    throw 'Official Node archive is missing node.exe.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $upstream 'LICENSE') -PathType Leaf)) {
    throw 'Official Node archive is missing LICENSE.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $app 'Start-ZHIROX.cmd') -PathType Leaf)) {
    throw 'Committed ZHIROX launcher missing from source ZIP.'
  }
  $runtime = Join-Path $app 'runtime'
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $upstream 'node.exe') -Destination (Join-Path $runtime 'node.exe')
  Copy-Item -LiteralPath (Join-Path $upstream 'LICENSE') -Destination (Join-Path $runtime 'Node-LICENSE.txt')
  $nodeHash = (Get-FileHash -LiteralPath (Join-Path $runtime 'node.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
  $manifest = [ordered]@{
    runtime = 'Node.js'
    version = $ver
    os = 'win32'
    arch = 'x64'
    provenance = "$url/$filename"
    upstream_archive_sha256 = $archiveHash
    node_exe_sha256 = $nodeHash
    license = 'Node-LICENSE.txt'
    qa_only = $true
    signed = $false
    install_required = $false
  }
  $manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $runtime 'node-manifest.json') -Encoding utf8
  $pkg = Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw | ConvertFrom-Json
  if ($pkg.version -notmatch '^0\.26\.0-dev\.\d+$') { throw 'Unexpected QA package version.' }
  $name = "ZHIROX-Windows-SelfContained-QA-$($pkg.version)-x64.zip"
  $destination = Join-Path $outputFull $name
  Compress-Archive -LiteralPath $app -DestinationPath $destination -CompressionLevel Optimal -Force
  $sha = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath "$destination.sha256" -Value "$sha  $name" -Encoding ascii
  Write-Output (ConvertTo-Json ([ordered]@{
    file = $destination
    sha256 = $sha
    node_version = $ver
    node_archive_sha256 = $archiveHash
    node_exe_sha256 = $nodeHash
    hardware_verified = $false
    qa_only = $true
  }) -Depth 3)
} finally {
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
