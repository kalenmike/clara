import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ServiceResult = {
  service: 'systemd' | 'launchd' | 'none'
  unitPath?: string
  actions: string[]
  warning?: string
}

export interface ServiceInput {
  entry: string
  configPath: string
  dryRun?: boolean
}

type ServiceKind = ServiceResult['service']

function nodeArgs(entry: string): string[] {
  return entry.endsWith('.ts') ? ['--experimental-strip-types', '--no-warnings', entry] : [entry]
}

function systemdUnit(input: ServiceInput): string {
  const args = [process.execPath, ...nodeArgs(input.entry), '--config', input.configPath]
    .map((value) => (value.includes(' ') ? `"${value}"` : value))
    .join(' ')
  return `[Unit]
Description=Clara script runner
After=default.target

[Service]
Type=simple
ExecStart=${args}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
}

function launchAgent(input: ServiceInput): string {
  const args = [process.execPath, ...nodeArgs(input.entry), '--config', input.configPath]
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.clara.runner</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xml(arg)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(join(dirname(input.configPath), 'runner.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(dirname(input.configPath), 'runner.log'))}</string>
</dict>
</plist>
`
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function run(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: 'ignore' })
  return result.status === 0
}

export function installService(input: ServiceInput): ServiceResult {
  const actions: string[] = []
  if (process.platform === 'linux') {
    const unitPath = join(
      process.env.XDG_CONFIG_HOME?.trim() || join(process.env.HOME || '', '.config'),
      'systemd',
      'user',
      'clara-runner.service'
    )
    const unit = systemdUnit(input)
    if (!input.dryRun) {
      mkdirSync(dirname(unitPath), { recursive: true, mode: 0o700 })
      writeFileSync(unitPath, unit, { mode: 0o600 })
      actions.push(`write systemd unit ${unitPath}`)
      const reloaded = run('systemctl', ['--user', 'daemon-reload'])
      const enabled = reloaded && run('systemctl', ['--user', 'enable', '--now', 'clara-runner'])
      if (enabled) actions.push('enable and start clara-runner.service')
      else {
        return {
          service: 'systemd',
          unitPath,
          actions,
          warning:
            'systemd user service was written but could not be enabled. Run: systemctl --user enable --now clara-runner',
        }
      }
    } else {
      actions.push(`write systemd unit ${unitPath}`)
    }
    return { service: 'systemd', unitPath, actions }
  }

  if (process.platform === 'darwin') {
    const unitPath = join(
      process.env.HOME || '',
      'Library',
      'LaunchAgents',
      'ai.clara.runner.plist'
    )
    if (!input.dryRun) {
      mkdirSync(dirname(unitPath), { recursive: true, mode: 0o700 })
      writeFileSync(unitPath, launchAgent(input), { mode: 0o600 })
      actions.push(`write launch agent ${unitPath}`)
      run('launchctl', ['unload', unitPath])
      const loaded = run('launchctl', ['load', '-w', unitPath])
      if (loaded) actions.push('load ai.clara.runner')
      else {
        return {
          service: 'launchd',
          unitPath,
          actions,
          warning: `launchctl could not load ${unitPath}`,
        }
      }
    } else {
      actions.push(`write launch agent ${unitPath}`)
    }
    return { service: 'launchd', unitPath, actions }
  }

  return {
    service: 'none',
    actions,
    warning: 'No user service manager is available. Run `clara-adapter runner` in the foreground.',
  }
}

export function removeService(service: ServiceKind, unitPath?: string): void {
  if (service === 'systemd') {
    run('systemctl', ['--user', 'disable', '--now', 'clara-runner'])
    if (unitPath && existsSync(unitPath)) unlinkSync(unitPath)
    run('systemctl', ['--user', 'daemon-reload'])
    return
  }
  if (service === 'launchd' && unitPath) {
    run('launchctl', ['unload', unitPath])
    if (existsSync(unitPath)) unlinkSync(unitPath)
    return
  }
  if (unitPath && existsSync(unitPath)) rmSync(unitPath, { force: true })
}

export function serviceActive(service: ServiceKind): 'active' | 'inactive' | 'unknown' {
  if (service === 'systemd') {
    const result = spawnSync('systemctl', ['--user', 'is-active', 'clara-runner'], {
      encoding: 'utf8',
    })
    if (result.status === 0) return 'active'
    return 'inactive'
  }
  if (service === 'launchd') {
    const result = spawnSync('launchctl', ['list', 'ai.clara.runner'], { encoding: 'utf8' })
    return result.status === 0 ? 'active' : 'inactive'
  }
  return 'unknown'
}
