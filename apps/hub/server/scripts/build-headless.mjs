#!/usr/bin/env node
// Build a headless hub-server archive for one target.
//
//   node scripts/build-headless.mjs [--target <bun-target>] [--no-archive]
//
// The Bun build already embeds the panel and compiles one standalone
// executable. This script adds the headless install helpers and an archive
// under dist/headless. Build each platform on its own host (or in CI): a Linux
// container cannot produce macOS or Windows binaries.

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repoRoot = resolve(packageRoot, '../../..')
const outputRoot = join(repoRoot, 'dist', 'headless')

const target = arg('--target') ?? hostTarget()
const label = target.replace(/^bun-/, '')
const windows = target.includes('windows')
const executable = windows ? 'clara-server.exe' : 'clara-server'
const archiveName = `clara-hub-${label}${windows ? '.zip' : '.tar.gz'}`
const stage = join(outputRoot, label)

function main() {
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })

  const built = join(stage, executable)
  run(
    process.execPath,
    ['scripts/build-bun.mjs', '--target', target, '--outfile', built],
    packageRoot
  )
  if (!existsSync(built)) fail(`The Bun build did not produce ${built}`)
  if (!windows) chmodSync(built, 0o755)

  writeFileSync(join(stage, 'README.txt'), readme(label), 'utf8')
  if (windows) writeFileSync(join(stage, 'install.ps1'), windowsInstall(), 'utf8')
  else {
    writeFileSync(join(stage, 'install.sh'), unixInstall(label), { mode: 0o755 })
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

function arg(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) fail(`${name} needs a value.`)
  return value.trim()
}

function hostTarget() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') return `bun-darwin-${arch}`
  if (process.platform === 'win32') return `bun-windows-${arch}`
  return `bun-linux-${arch}`
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
