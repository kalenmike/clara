#!/usr/bin/env node
// Build a headless hub-server archive for one target.
//
//   node scripts/build-headless.mjs [--target <rust-triple>] [--no-archive]
//
// The sidecar build already embeds the panel and compiles one standalone
// executable. This script adds the headless install helpers and an archive
// under dist/headless. Build each platform on its own host (or in CI): a Linux
// container cannot produce macOS or Windows binaries.

import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repoRoot = resolve(packageRoot, '../../..')
const binaries = join(packageRoot, 'src-tauri', 'binaries')
const outputRoot = join(repoRoot, 'dist', 'headless')

const target = resolveTarget(process.argv.slice(2))
const windows = target.includes('windows')
const executable = windows ? 'clara-server.exe' : 'clara-server'
const archiveName = `clara-hub-${target}${windows ? '.zip' : '.tar.gz'}`
const stage = join(outputRoot, target)

function main() {
  const args = ['scripts/build-sidecar.mjs', '--target', target]
  run(process.execPath, args, packageRoot)

  const built = join(binaries, `clara-server-${target}${windows ? '.exe' : ''}`)
  if (!existsSync(built)) fail(`The sidecar build did not produce ${built}`)

  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  copyFileSync(built, join(stage, executable))
  if (!windows) chmodSync(join(stage, executable), 0o755)

  writeFileSync(join(stage, 'README.txt'), readme(target), 'utf8')
  if (windows) writeFileSync(join(stage, 'install.ps1'), windowsInstall(), 'utf8')
  else {
    writeFileSync(join(stage, 'install.sh'), unixInstall(target), { mode: 0o755 })
    writeFileSync(join(stage, 'clara-hub.service'), systemdUnit(), { mode: 0o644 })
    writeFileSync(join(stage, 'com.clara.hub.plist'), launchdPlist(), { mode: 0o644 })
  }

  if (!process.argv.includes('--no-archive')) archive()

  console.log('')
  console.log(`Headless hub: ${stage}`)
  if (!process.argv.includes('--no-archive')) {
    console.log(`Archive:      ${join(outputRoot, archiveName)}`)
  }
}

function archive() {
  mkdirSync(outputRoot, { recursive: true })
  const output = join(outputRoot, archiveName)
  rmSync(output, { force: true })
  if (windows) {
    run(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${stage}\\*' -DestinationPath '${output}'`,
      ],
      repoRoot
    )
  } else {
    run('tar', ['-czf', output, '-C', stage, '.'], repoRoot)
  }
}

function readme(value) {
  const command = value.includes('windows') ? 'clara-server.exe' : './clara-server'
  return `Clara hub server (headless)

Target: ${value}

1. Extract this archive somewhere stable.
2. Run the hub:

   ${command} serve

   The panel listens on http://127.0.0.1:8790/ by default. On first run the
   hub starts no transports until you create the owner account.

3. Create the owner account in the panel, or from a shell:

   ${command} setup --username admin --password-stdin

   Or set CLARA_ADMIN_PASSWORD (or CLARA_ADMIN_PASSWORD_FILE) before starting
   the hub for an unattended install.

4. Install it as a login service:

   ${value.includes('windows') ? 'powershell -ExecutionPolicy Bypass -File .\\install.ps1' : './install.sh'}

Configuration:
  CLARA_CONFIG_DIR   default ~/.config/clara
  CLARA_DATA_DIR     default ~/.local/share/clara
  CLARA_PANEL_PORT   default 8790 (loopback)

The hub panel stays on loopback. Use the relay for remote clients; do not
publish the panel.
`
}

function unixInstall(value) {
  if (value.includes('darwin')) {
    return `#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
bin="$HOME/.local/bin"
mkdir -p "$bin" "$HOME/Library/LaunchAgents"
cp "$here/clara-server" "$bin/clara-server"
chmod 755 "$bin/clara-server"
sed "s|@BIN@|$bin/clara-server|g" "$here/com.clara.hub.plist" > "$HOME/Library/LaunchAgents/com.clara.hub.plist"
launchctl unload "$HOME/Library/LaunchAgents/com.clara.hub.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/com.clara.hub.plist"
echo "Clara hub installed. Open http://127.0.0.1:8790/ to create the owner account."
`
  }
  return `#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
bin="$HOME/.local/bin"
unit="$HOME/.config/systemd/user"
mkdir -p "$bin" "$unit" "$HOME/.config/clara"
cp "$here/clara-server" "$bin/clara-server"
chmod 755 "$bin/clara-server"
sed "s|@BIN@|$bin/clara-server|g" "$here/clara-hub.service" > "$unit/clara-hub.service"
systemctl --user daemon-reload
systemctl --user enable --now clara-hub.service
echo "Clara hub installed. Open http://127.0.0.1:8790/ to create the owner account."
`
}

function systemdUnit() {
  return `[Unit]
Description=Clara hub service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=-%h/.config/clara/server.env
ExecStart=@BIN@ serve
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`
}

function launchdPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.clara.hub</string>
  <key>ProgramArguments</key>
  <array>
    <string>@BIN@</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/clara-hub.log</string>
  <key>StandardErrorPath</key><string>/tmp/clara-hub.log</string>
</dict>
</plist>
`
}

function windowsInstall() {
  return `$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path $here 'clara-server.exe'
$config = Join-Path $env:USERPROFILE '.config\\clara'
$data = Join-Path $env:USERPROFILE '.local\\share\\clara'
New-Item -ItemType Directory -Force -Path $config, $data | Out-Null
$action = New-ScheduledTaskAction -Execute $bin -Argument 'serve' -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'ClaraHub' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'ClaraHub'
Write-Host 'Clara hub installed. Open http://127.0.0.1:8790/ to create the owner account.'
`
}

function resolveTarget(argv) {
  const index = argv.indexOf('--target')
  const fromArg = index >= 0 ? argv[index + 1] : undefined
  const configured =
    fromArg?.trim() ||
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() ||
    process.env.CARGO_BUILD_TARGET?.trim()
  if (configured) return configured

  const rustc = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  const host = rustc.status === 0 ? /^host:\s*(\S+)$/m.exec(rustc.stdout)?.[1] : undefined
  if (host) return host

  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`
  return `${arch}-unknown-linux-gnu`
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) fail(`${command} could not run: ${result.error.message}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function fail(message) {
  console.error(`hub headless: ${message}`)
  process.exit(1)
}

main()
