# Clara installer for Windows.
#
#   irm https://github.com/kalenmike/clara/releases/latest/download/install.ps1 | iex
#
# Verifies the archive checksum from the release manifest, extracts it under
# the user's local data directory, and links `clara` into the user's bin folder.
# The binary verifies the Ed25519 manifest signature for later updates.

$ErrorActionPreference = 'Stop'

$BaseUrl = if ($env:CLARA_RELEASE_BASE_URL) { $env:CLARA_RELEASE_BASE_URL } else { 'https://github.com/kalenmike/clara/releases/latest/download' }
$BinDir = if ($env:CLARA_BIN_DIR) { $env:CLARA_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'Clara\bin' }
$DataDir = if ($env:CLARA_DATA_DIR) { $env:CLARA_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'Clara\data' }

$isArm = $env:PROCESSOR_ARCHITECTURE -eq 'ARM64'
$platform = if ($isArm) { 'win32-arm64' } else { 'win32-x64' }

$tmp = Join-Path $env:TEMP ("clara-install-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  Write-Host "Clara installer for $platform"
  Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/manifest.json" -OutFile "$tmp\manifest.json"
  $manifest = Get-Content "$tmp\manifest.json" -Raw | ConvertFrom-Json
  $artifact = $manifest.artifacts.$platform
  if (-not $artifact) { throw "The release has no build for $platform." }

  $version = if ($env:CLARA_VERSION) { $env:CLARA_VERSION } else { $manifest.version }
  Write-Host "Downloading Clara $version"
  $archive = Join-Path $tmp 'clara.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $artifact.url -OutFile $archive

  $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
  if ($actual -ne $artifact.sha256.ToLowerInvariant()) { throw 'The download checksum did not match.' }

  $root = Join-Path $DataDir "versions\$version"
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath $root -Force

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $source = Join-Path $root 'clara.exe'
  $target = Join-Path $BinDir 'clara.exe'
  Copy-Item -Force -Path $source -Destination $target

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$BinDir", 'User')
    Write-Host "Added $BinDir to your user PATH. Open a new terminal."
  }

  Write-Host "Installed Clara $version to $root"
  Write-Host "Run: clara setup"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
