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
import type { AdapterPaths, AdapterProcessStatus, ServiceResult } from './types.ts'

export type AdapterServiceInput = {
  name: string
  label: string
  entry: string
  paths: AdapterPaths
}

function unitName(name: string): string {
  return `clara-adapter-${name}`
}

function launchLabel(name: string): string {
  return `ai.clara.adapter-${name}`
}

function nodeArgs(entry: string): string[] {
  return entry.endsWith('.ts') ? ['--experimental-strip-types', '--no-warnings', entry] : [entry]
}

/**
 * The script path when this process was started by a JS runtime, or an empty
 * string when it is a Bun-compiled executable. Compiled executables do not have
 * a script argument; `process.argv[1]` is the first CLI command instead.
 */
export function selfEntry(argv: string[] = process.argv): string {
  const candidate = argv[1] ?? ''
  if (!candidate || candidate.startsWith('-')) return ''
  return /\.(?:[cm]?[jt]s)$/i.test(candidate) ? candidate : ''
}

function selfArgs(entry: string, command: string): string[] {
  if (!entry || entry === process.execPath) return [command]
  return [...nodeArgs(entry), command]
}

function run(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: 'ignore' }).status === 0
}

function quote(value: string): string {
  return value.includes(' ') ? `"${value}"` : value
}

function systemdUnitPath(name: string): string {
  return join(
    process.env.XDG_CONFIG_HOME?.trim() || join(process.env.HOME || '', '.config'),
    'systemd',
    'user',
    `${unitName(name)}.service`
  )
}

function launchAgentPath(name: string): string {
  return join(process.env.HOME || '', 'Library', 'LaunchAgents', `${launchLabel(name)}.plist`)
}

type AdapterServiceKind = 'systemd' | 'launchd' | 'none'

/** Which user service, if any, was installed for this adapter. */
export function adapterServiceKind(name: string): AdapterServiceKind {
  if (process.platform === 'linux' && existsSync(systemdUnitPath(name))) return 'systemd'
  if (process.platform === 'darwin' && existsSync(launchAgentPath(name))) return 'launchd'
  return 'none'
}

/** True when the installed user service is currently running. */
export function adapterServiceActive(name: string): boolean {
  const kind = adapterServiceKind(name)
  if (kind === 'systemd')
    return run('systemctl', ['--user', 'is-active', '--quiet', unitName(name)])
  if (kind === 'launchd') return run('launchctl', ['list', launchLabel(name)])
  return false
}

/** Start an installed user service; returns false when there is none. */
export function startAdapterService(name: string): boolean {
  const kind = adapterServiceKind(name)
  if (kind === 'systemd') return run('systemctl', ['--user', 'start', unitName(name)])
  if (kind === 'launchd') return run('launchctl', ['load', '-w', launchAgentPath(name)])
  return false
}

/** Stop an installed user service without removing it. */
export function stopAdapterService(name: string): string[] {
  const kind = adapterServiceKind(name)
  if (kind === 'systemd') {
    return run('systemctl', ['--user', 'stop', unitName(name)])
      ? [`stop systemd service ${unitName(name)}`]
      : []
  }
  if (kind === 'launchd') {
    return run('launchctl', ['unload', launchAgentPath(name)])
      ? [`stop launch agent ${launchLabel(name)}`]
      : []
  }
  return []
}

export function foregroundCommand(entry: string, command = 'serve'): string {
  return [process.execPath, ...selfArgs(entry, command)].map(quote).join(' ')
}

/** True when `clara` installed this adapter and owns its config and data paths. */
function claraManaged(): boolean {
  return Boolean(
    process.env.CLARA_ADAPTER_CONFIG_DIR?.trim() || process.env.CLARA_ADAPTER_DATA_DIR?.trim()
  )
}

/**
 * A command a person can actually run. A downloaded adapter lives under the
 * Clara data directory and is not on `PATH`, so naming its binary alone gives
 * a "command not found". Use the Clara command when it owns the install, and
 * the exact executable path otherwise.
 */
export function adapterStartCommand(name: string, entry: string): string {
  if (claraManaged() && !selfEntry()) return `clara adapter start ${name}`
  return foregroundCommand(entry, 'start')
}

/** Pair an adapter, through `clara` when it owns the install. */
export function adapterInstallCommand(name: string, entry: string, pair = '<code>'): string {
  if (claraManaged() && !selfEntry()) return `clara adapter install ${name} --pair ${pair}`
  return `${foregroundCommand(entry, 'install')} --pair ${pair}`
}

export function adapterLogSize(paths: AdapterPaths): number {
  try {
    return existsSync(paths.logPath) ? readFileSync(paths.logPath).byteLength : 0
  } catch {
    return 0
  }
}

export async function waitForAdapterAuthentication(
  paths: AdapterPaths,
  fromOffset: number,
  timeoutMs = 8_000
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const pid = readPid(paths)
    if (pid === undefined || !isAlive(pid)) return false
    let text = ''
    try {
      text = readFileSync(paths.logPath, 'utf8').slice(fromOffset)
    } catch {
      // The log may not exist yet.
    }
    if (text.includes('adapter authenticated')) return true
    if (
      text.includes('adapter session error') ||
      text.includes('could not open a frame') ||
      text.includes('adapter socket error')
    ) {
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

function userSystemdAvailable(): boolean {
  if (!process.env.XDG_RUNTIME_DIR?.trim()) return false
  return run('systemctl', ['--user', 'show-environment'])
}

export function installAdapterService(input: AdapterServiceInput): ServiceResult {
  const args = [process.execPath, ...selfArgs(input.entry, 'serve')]
  if (process.platform === 'linux') {
    if (!userSystemdAvailable()) {
      return {
        service: 'none',
        actions: [],
        warning:
          'User systemd is not available; the adapter will run as a background process instead.',
      }
    }
    const name = unitName(input.name)
    const unitPath = systemdUnitPath(input.name)
    mkdirSync(dirname(unitPath), { recursive: true, mode: 0o700 })
    writeFileSync(
      unitPath,
      `[Unit]\nDescription=Clara ${input.label} adapter\nAfter=default.target\n\n[Service]\nType=simple\nExecStart=${args
        .map(quote)
        .join(' ')}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`,
      { mode: 0o600 }
    )
    const loaded =
      run('systemctl', ['--user', 'daemon-reload']) &&
      run('systemctl', ['--user', 'enable', '--now', name])
    return {
      service: 'systemd',
      unitPath,
      actions: [`write systemd unit ${unitPath}`],
      ...(loaded
        ? {}
        : {
            warning: `systemd user service was written but could not be enabled. Run: systemctl --user enable --now ${name}`,
          }),
    }
  }
  if (process.platform === 'darwin') {
    const label = launchLabel(input.name)
    const unitPath = launchAgentPath(input.name)
    mkdirSync(dirname(unitPath), { recursive: true, mode: 0o700 })
    writeFileSync(
      unitPath,
      `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args
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

export function adapterProcessStatus(paths: AdapterPaths): AdapterProcessStatus {
  const pid = readPid(paths)
  if (pid === undefined) return { running: false, log: paths.logPath }
  return { running: isAlive(pid), pid, log: paths.logPath }
}

/** Record this process as the adapter owner so `start`, `status`, and `stop` agree. */
export function writeAdapterPid(paths: AdapterPaths, pid = process.pid): void {
  mkdirSync(dirname(paths.pidPath), { recursive: true, mode: 0o700 })
  writeFileSync(paths.pidPath, `${pid}\n`, { mode: 0o600 })
}

/** Remove the pid file only when it still names this process. */
export function clearAdapterPid(paths: AdapterPaths, pid = process.pid): void {
  if (readPid(paths) !== pid) return
  rmPid(paths)
}

export function startAdapterProcess(input: AdapterServiceInput): ServiceResult {
  const existing = readPid(input.paths)
  if (existing !== undefined && isAlive(existing)) {
    return { service: 'process', actions: [`adapter already running (pid ${existing})`] }
  }
  rmPid(input.paths)
  mkdirSync(dirname(input.paths.logPath), { recursive: true, mode: 0o700 })
  const log = openSync(input.paths.logPath, 'a', 0o600)
  try {
    const child = spawn(process.execPath, selfArgs(input.entry, 'serve'), {
      detached: true,
      stdio: ['ignore', log, log],
      env: process.env,
    })
    child.unref()
    if (child.pid === undefined) throw new Error('Could not start the adapter process')
    writeAdapterPid(input.paths, child.pid)
    return { service: 'process', actions: [`start adapter process (pid ${child.pid})`] }
  } finally {
    closeSync(log)
  }
}

/** Stop the installed user service and any background process it started. */
export function stopAdapter(name: string, paths: AdapterPaths): string[] {
  const actions = stopAdapterService(name)
  actions.push(...stopAdapterProcess(paths))
  return actions
}

export function stopAdapterProcess(paths: AdapterPaths): string[] {
  const actions: string[] = []
  const pid = readPid(paths)
  if (pid === undefined) return ['adapter process is not running']
  if (isAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM')
      actions.push(`stop adapter process (pid ${pid})`)
    } catch {
      // Already gone.
    }
  }
  rmPid(paths)
  return actions
}

export function tailAdapterLog(paths: AdapterPaths, lines = 80): string {
  if (!existsSync(paths.logPath)) return 'No adapter log yet.'
  const text = readFileSync(paths.logPath, 'utf8').trimEnd().split('\n')
  return text.slice(-lines).join('\n')
}

export function removeAdapterService(input: AdapterServiceInput): string[] {
  const actions: string[] = [...stopAdapterProcess(input.paths)]
  if (process.platform === 'linux') {
    const name = unitName(input.name)
    const unitPath = systemdUnitPath(input.name)
    run('systemctl', ['--user', 'disable', '--now', name])
    try {
      unlinkSync(unitPath)
      actions.push(`remove systemd unit ${unitPath}`)
    } catch {
      // Already removed.
    }
    run('systemctl', ['--user', 'daemon-reload'])
  }
  if (process.platform === 'darwin') {
    const unitPath = launchAgentPath(input.name)
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

/** Resolve a built or source entry for a package directory. */
export function adapterEntry(
  root: string,
  sources: string[] = ['dist/index.js', 'src/index.ts']
): string {
  const candidates = sources.flatMap((source) => [
    resolve(root, source),
    resolve(process.cwd(), source),
  ])
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`The adapter entry is missing under ${root}. Build it and retry.`)
}

function readPid(paths: AdapterPaths): number | undefined {
  if (!existsSync(paths.pidPath)) return undefined
  const value = Number.parseInt(readFileSync(paths.pidPath, 'utf8').trim(), 10)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function rmPid(paths: AdapterPaths): void {
  try {
    unlinkSync(paths.pidPath)
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
