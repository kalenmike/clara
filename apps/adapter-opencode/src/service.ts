import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ServiceResult = {
  service: 'systemd' | 'launchd' | 'none'
  unitPath?: string
  actions: string[]
  warning?: string
}

function nodeArgs(entry: string): string[] {
  return entry.endsWith('.ts') ? ['--experimental-strip-types', '--no-warnings', entry] : [entry]
}

function run(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: 'ignore' }).status === 0
}

export function installAdapterService(entry: string): ServiceResult {
  const args = [process.execPath, ...nodeArgs(entry), 'serve']
  if (process.platform === 'linux') {
    const unitPath = join(
      process.env.XDG_CONFIG_HOME?.trim() || join(process.env.HOME || '', '.config'),
      'systemd',
      'user',
      'clara-adapter-opencode.service'
    )
    mkdirSync(dirname(unitPath), { recursive: true, mode: 0o700 })
    writeFileSync(
      unitPath,
      `[Unit]\nDescription=Clara OpenCode adapter\nAfter=default.target\n\n[Service]\nType=simple\nExecStart=${args
        .map((value) => (value.includes(' ') ? `"${value}"` : value))
        .join(' ')}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`,
      { mode: 0o600 }
    )
    const loaded =
      run('systemctl', ['--user', 'daemon-reload']) &&
      run('systemctl', ['--user', 'enable', '--now', 'clara-adapter-opencode'])
    return {
      service: 'systemd',
      unitPath,
      actions: [`write systemd unit ${unitPath}`],
      ...(loaded
        ? {}
        : {
            warning:
              'systemd user service was written but could not be enabled. Run: systemctl --user enable --now clara-adapter-opencode',
          }),
    }
  }
  if (process.platform === 'darwin') {
    const unitPath = join(
      process.env.HOME || '',
      'Library',
      'LaunchAgents',
      'ai.clara.adapter-opencode.plist'
    )
    mkdirSync(dirname(unitPath), { recursive: true, mode: 0o700 })
    writeFileSync(
      unitPath,
      `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>ai.clara.adapter-opencode</string><key>ProgramArguments</key><array>${args
        .map((value) => `<string>${value}</string>`)
        .join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>\n`,
      { mode: 0o600 }
    )
    run('launchctl', ['unload', unitPath])
    run('launchctl', ['load', '-w', unitPath])
    return { service: 'launchd', unitPath, actions: [`write launch agent ${unitPath}`] }
  }
  return { service: 'none', actions: [] }
}

export function adapterEntry(): string {
  const built = new URL('../dist/index.js', import.meta.url).pathname
  if (existsSync(built)) return built
  return new URL('./index.ts', import.meta.url).pathname
}

export function removeAdapterService(): string[] {
  const actions: string[] = []
  if (process.platform === 'linux') {
    const unitPath = join(
      process.env.XDG_CONFIG_HOME?.trim() || join(process.env.HOME || '', '.config'),
      'systemd',
      'user',
      'clara-adapter-opencode.service'
    )
    run('systemctl', ['--user', 'disable', '--now', 'clara-adapter-opencode'])
    try {
      unlinkSync(unitPath)
      actions.push(`remove systemd unit ${unitPath}`)
    } catch {
      // Already removed.
    }
    run('systemctl', ['--user', 'daemon-reload'])
  }
  if (process.platform === 'darwin') {
    const unitPath = join(
      process.env.HOME || '',
      'Library',
      'LaunchAgents',
      'ai.clara.adapter-opencode.plist'
    )
    run('launchctl', ['unload', unitPath])
    try {
      unlinkSync(unitPath)
      actions.push(`remove launch agent ${unitPath}`)
    } catch {
      // Already removed.
    }
  }
  return actions
}
