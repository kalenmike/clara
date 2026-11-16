# Clara installer for Windows.
#
#   irm https://clara.kalenmichael.com/install.ps1 | iex
#
# Verifies the archive checksum from the signed release manifest, installs the
# command under the user's local data directory, links `clara` into the user's
# bin folder, and installs the Clara desktop app. Download the script first to
# pass -NoDesktop or other parameters.

param(
  [switch]$Desktop,
  [switch]$NoDesktop
)

$ErrorActionPreference = 'Stop'

$BaseUrl = if ($env:CLARA_RELEASE_BASE_URL) { $env:CLARA_RELEASE_BASE_URL } else { '__CLARA_RELEASE_BASE_URL__' }
$FallbackBaseUrl = 'https://github.com/kalenmike/clara/releases/latest/download'
$BinDir = if ($env:CLARA_BIN_DIR) { $env:CLARA_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'Clara\bin' }
$DataDir = if ($env:CLARA_DATA_DIR) { $env:CLARA_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'Clara\data' }
$RequestedVersion = $env:CLARA_VERSION

$isArm = $env:PROCESSOR_ARCHITECTURE -eq 'ARM64'
$platform = if ($isArm) { 'win32-arm64' } else { 'win32-x64' }

$installDesktop = -not $NoDesktop
if ($Desktop) { $installDesktop = $true }
if ($env:CLARA_NO_DESKTOP -eq '1') { $installDesktop = $false }

$tmp = Join-Path $env:TEMP ("clara-install-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Read-Manifest([string]$root) {
  Invoke-WebRequest -UseBasicParsing -Uri "$root/manifest.json" -OutFile "$tmp\manifest.json"
  Get-Content "$tmp\manifest.json" -Raw | ConvertFrom-Json
}

try {
  Write-Host "Clara installer for $platform"
  try {
    $manifest = Read-Manifest $BaseUrl
  } catch {
    if ($env:CLARA_RELEASE_BASE_URL -or $BaseUrl -eq $FallbackBaseUrl) { throw }
    Write-Host 'The registry is unavailable; using the GitHub release.'
    $BaseUrl = $FallbackBaseUrl
    $manifest = Read-Manifest $BaseUrl
  }

  if (-not $manifest.cli) { throw 'The release manifest has no CLI section.' }
  $artifact = $manifest.cli.artifacts.$platform
  if (-not $artifact) { throw "The release has no build for $platform." }

  Write-Host 'Downloading Clara'
  $archive = Join-Path $tmp 'clara.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $artifact.url -OutFile $archive

  $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
  if ($actual -ne $artifact.sha256.ToLowerInvariant()) {
    throw 'The download checksum did not match.'
  }

  $unpack = Join-Path $tmp 'unpack'
  New-Item -ItemType Directory -Force -Path $unpack | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath $unpack -Force
  $binary = Join-Path $unpack 'clara.exe'
  $versionLine = (& $binary --version) -join ' '
  $version = ($versionLine -split '\s+')[0]
  if (-not $version) { $version = $manifest.cli.version }
  if ($RequestedVersion -and $RequestedVersion -ne $version) {
    throw "The release contains Clara $version, not $RequestedVersion."
  }

  $root = Join-Path $DataDir "versions\$version"
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  Copy-Item -Force -Path $binary -Destination (Join-Path $root 'clara.exe')

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $target = Join-Path $BinDir 'clara.exe'
  Copy-Item -Force -Path (Join-Path $root 'clara.exe') -Destination $target

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$BinDir", 'User')
    Write-Host "Added $BinDir to your user PATH. Open a new terminal."
  }

  Write-Host "Installed Clara $version to $root"

  if ($installDesktop) {
    Write-Host 'Installing the Clara desktop app'
    & $target desktop install --base-url $BaseUrl --bin-dir $BinDir --optional
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'The desktop app was not installed. Run `clara desktop install` later.'
    }
  }

  Write-Host 'Run: clara setup'
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
