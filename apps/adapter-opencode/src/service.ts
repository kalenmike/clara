import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adapterLogPath, adapterPidPath } from './config.ts'

export type ServiceResult = {
  service: 'systemd' | 'launchd' | 'process' | 'none'
  unitPath?: string
  actions: string[]
  warning?: string
}

export type AdapterProcessStatus = {
  running: boolean
  pid?: number
  log: string
}

function nodeArgs(entry: string): string[] {
  return entry.endsWith('.ts') ? ['--experimental-strip-types', '--no-warnings', entry] : [entry]
}

function run(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: 'ignore' }).status === 0
}

function fileUrl(candidate: URL): string {
  return fileURLToPath(candidate)
}

/**
 * Resolve the adapter CLI entry in both layouts:
 *   apps/adapter-opencode/src/service.ts
 *   packages/adapter/dist/cli.js (adapter code is bundled into the installer)
 */
export function adapterEntry(): string {
  const configured = process.env.CLARA_ADAPTER_ENTRY?.trim()
  if (configured) return resolve(configured)

  const candidates = [
    join(process.cwd(), 'apps/adapter-opencode/dist/index.js'),
    join(process.cwd(), 'apps/adapter-opencode/src/index.ts'),
    fileUrl(new URL('../dist/index.js', import.meta.url)),
    fileUrl(new URL('./index.ts', import.meta.url)),
    fileUrl(new URL('../../../apps/adapter-opencode/dist/index.js', import.meta.url)),
    fileUrl(new URL('../../../apps/adapter-opencode/src/index.ts', import.meta.url)),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    'The OpenCode adapter entry is missing. Run `pnpm --filter @clara/adapter-opencode build` and retry.'
  )
}

export function foregroundCommand(entry = adapterEntry()): string {
  return [process.execPath, ...nodeArgs(entry), 'serve']
    .map((value) => (value.includes(' ') ? `"${value}"` : value))
    .join(' ')
}

function userSystemdAvailable(): boolean {
  if (!process.env.XDG_RUNTIME_DIR?.trim()) return false
  return run('systemctl', ['--user', 'show-environment'])
}

export function installAdapterService(entry: string): ServiceResult {
  const args = [process.execPath, ...nodeArgs(entry), 'serve']
  if (process.platform === 'linux') {
    if (!userSystemdAvailable()) {
      return {
        service: 'none',
        actions: [],
        warning:
          'User systemd is not available; the adapter will run as a background process instead.',
      }
    }
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

export function adapterProcessStatus(): AdapterProcessStatus {
  const log = adapterLogPath()
  const pid = readPid()
  if (pid === undefined) return { running: false, log }
  return { running: isAlive(pid), pid, log }
}

export function startAdapterProcess(entry = adapterEntry()): ServiceResult {
  const existing = readPid()
  if (existing !== undefined && isAlive(existing)) {
    return { service: 'process', actions: [`adapter already running (pid ${existing})`] }
  }
  rmPid()
  mkdirSync(dirname(adapterLogPath()), { recursive: true, mode: 0o700 })
  const log = openSync(adapterLogPath(), 'a', 0o600)
  try {
    const child = spawn(process.execPath, [...nodeArgs(entry), 'serve'], {
      detached: true,
      stdio: ['ignore', log, log],
      env: process.env,
    })
    child.unref()
    if (child.pid === undefined) throw new Error('Could not start the adapter process')
    writeFileSync(adapterPidPath(), `${child.pid}\n`, { mode: 0o600 })
    return { service: 'process', actions: [`start adapter process (pid ${child.pid})`] }
  } finally {
    closeSync(log)
  }
}

export function stopAdapterProcess(): string[] {
  const actions: string[] = []
  const pid = readPid()
  if (pid === undefined) return ['adapter process is not running']
  if (isAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM')
      actions.push(`stop adapter process (pid ${pid})`)
    } catch {
      // Already gone.
    }
  }
  rmPid()
  return actions
}

export function tailAdapterLog(lines = 80): string {
  if (!existsSync(adapterLogPath())) return 'No adapter log yet.'
  const text = readFileSync(adapterLogPath(), 'utf8').trimEnd().split('\n')
  return text.slice(-lines).join('\n')
}

export function removeAdapterService(): string[] {
  const actions: string[] = [...stopAdapterProcess()]
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

function readPid(): number | undefined {
  if (!existsSync(adapterPidPath())) return undefined
  const value = Number.parseInt(readFileSync(adapterPidPath(), 'utf8').trim(), 10)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function rmPid(): void {
  try {
    unlinkSync(adapterPidPath())
  } catch {
    // Already removed.
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
