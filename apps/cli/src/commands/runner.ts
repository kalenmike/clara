import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { readRunnerConfig, engineToken } from '@clara/runner'
import { resolvePorts } from '../ports.ts'
import { join } from 'node:path'
import { resolvePaths } from '../paths.ts'
import { detectRole } from '../state/role.ts'
import { selfCommand } from '../self.ts'
import {
  clearRunnerPid,
  engineRunnerReport,
  followRunnerLog,
  runnerLogPath,
  runnerPidPath,
  runnerProcess,
  writeRunnerPid,
} from '../state/runner.ts'
import { dim, green, red, yellow } from '../ui/color.ts'
import { formatDuration, success, warn } from '../ui/index.ts'
import { runnerStartGuard } from './role-guard.ts'

type StartOptions = {
  workspace?: string
  foreground: boolean
}

type LogOptions = {
  lines: number
  follow: boolean
}

/** `clara runner <start|stop|status|logs>` */
export async function runRunnerCommand(args: readonly string[]): Promise<number> {
  const [sub = '', ...rest] = args
  if (sub === 'start') return runRunnerStart(rest)
  if (sub === 'stop') return runRunnerStop(rest)
  if (sub === 'status') return runRunnerStatus(rest)
  if (sub === 'logs') return runRunnerLogs(rest)
  if (sub === '' || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(
      [
        'Manage the shared script runner',
        '',
        'Usage:',
        '  clara runner start [--workspace <path>] [--foreground]',
        '  clara runner stop',
        '  clara runner status [--workspace <path>] [--json]',
        '  clara runner logs [--tail <n>] [--no-follow]',
      ].join('\n')
    )
    return 0
  }
  throw new Error(`unknown runner command: ${sub} (try \`clara runner --help\`)`)
}

/** `clara runner start [--workspace <path>] [--foreground]` */
export async function runRunnerStart(args: readonly string[]): Promise<number> {
  const options = parseStart(args)
  const paths = resolvePaths()
  const guard = runnerStartGuard(detectRole(paths))
  if (guard) {
    console.error(guard)
    return 1
  }
  const current = runnerProcess(paths)
  if (current.running) {
    console.log(`The runner is already running (pid ${current.pid}).`)
    return 0
  }
  clearRunnerPid(paths)
  if (!engineToken()) {
    throw new Error('No engine token. Start the engine or set CLARA_ENGINE_TOKEN.')
  }

  const forwarded = options.workspace ? ['--workspace', options.workspace] : []
  const configPath = join(paths.configDir, 'runner.json')
  const engineUrl = localEngineUrl()
  if (options.foreground) {
    process.env.CLARA_ENGINE_URL ??= engineUrl
    const { serveRunner } = await import('../serve/runner.ts')
    writeRunnerPid(paths, process.pid)
    const cleanup = () => clearRunnerPid(paths)
    process.once('exit', cleanup)
    try {
      await serveRunner(['--config', configPath, ...forwarded])
    } finally {
      process.removeListener('exit', cleanup)
      cleanup()
    }
    return 0
  }

  mkdirSync(paths.logDir, { recursive: true, mode: 0o700 })
  const log = openSync(runnerLogPath(paths), 'a', 0o600)
  try {
    const invocation = selfCommand(['__serve', 'runner', '--config', configPath, ...forwarded])
    const child = spawn(invocation.command, invocation.args, {
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true,
      env: { ...process.env, CLARA_ENGINE_URL: engineUrl },
    })
    child.unref()
    if (child.pid === undefined) throw new Error('Could not start the runner process.')
    writeRunnerPid(paths, child.pid)
    console.log(success(`Started the runner (pid ${child.pid}).`))
    console.log(dim(`Logs: ${runnerLogPath(paths)}`))
    return 0
  } finally {
    closeSync(log)
  }
}

/** `clara runner stop` */
export async function runRunnerStop(_args: readonly string[]): Promise<number> {
  const paths = resolvePaths()
  const current = runnerProcess(paths)
  if (!current.running || current.pid === undefined) {
    clearRunnerPid(paths)
    console.log('The runner is not running.')
    return 0
  }
  try {
    process.kill(current.pid, 'SIGTERM')
  } catch {
    clearRunnerPid(paths)
    console.log('The runner is not running.')
    return 0
  }
  const stopped = await waitForExit(current.pid, 5_000)
  if (!stopped) {
    console.error(warn(`The runner (pid ${current.pid}) did not stop within 5s.`))
    return 1
  }
  clearRunnerPid(paths)
  console.log(success(`Stopped the runner (pid ${current.pid}).`))
  return 0
}

/** `clara runner status [--workspace <path>] [--json]` */
export async function runRunnerStatus(args: readonly string[]): Promise<number> {
  const { workspace, json } = parseStatus(args)
  const paths = resolvePaths()
  const current = runnerProcess(paths)
  const configPath = join(paths.configDir, 'runner.json')
  const saved = readRunnerConfig(configPath)
  const engine = await engineRunnerReport(workspace ? { workspace } : {})
  if (json) {
    console.log(
      JSON.stringify(
        {
          engine: {
            url: engine.url,
            reachable: engine.reachable,
            error: engine.error ?? null,
          },
          ...(workspace ? { workspace } : {}),
          runners: engine.runners,
          local: {
            state: current.running ? 'running' : 'stopped',
            pid: current.pid ?? null,
            workspace: saved?.workspace ?? null,
            concurrency: saved?.concurrency ?? null,
            configPath,
            log: runnerLogPath(paths),
            pidFile: runnerPidPath(paths),
          },
        },
        null,
        2
      )
    )
    return 0
  }
  const engineLabel = engine.reachable ? engine.url : `${engine.url} ${red('(unreachable)')}`
  console.log(`engine:    ${engineLabel}`)
  if (!engine.reachable && engine.error) console.log(dim(`           ${engine.error}`))
  if (workspace) console.log(`workspace: ${workspace}`)
  if (engine.runners.length === 0) {
    console.log(`runners:   ${dim('none registered')}`)
  } else {
    console.log('runners:')
    for (const runner of engine.runners) {
      const state = runner.live
        ? green(`live  ${formatDuration(runner.ageMs)}`)
        : yellow(`stale ${formatDuration(runner.ageMs)}`)
      const machine = runner.machine ? ` @${runner.machine}` : ''
      console.log(`  ${state}  ${runner.workspace}${machine}  ${dim(runner.id)}`)
    }
  }
  console.log(
    `local:     ${
      current.running
        ? green(`shared runner running (pid ${current.pid})`)
        : dim('no local shared runner')
    }`
  )
  console.log(`config:    ${configPath}`)
  console.log(`log:       ${runnerLogPath(paths)}`)
  return 0
}

/** The packaged stack keeps the engine on loopback; do not inherit the container hostname. */
function localEngineUrl(): string {
  return process.env.CLARA_ENGINE_URL?.trim() || `http://127.0.0.1:${resolvePorts().engine}`
}

/** `clara runner logs [--tail <n>] [--no-follow]` */
export async function runRunnerLogs(args: readonly string[]): Promise<number> {
  const options = parseLogs(args)
  return followRunnerLog({
    path: runnerLogPath(resolvePaths()),
    lines: options.lines,
    follow: options.follow,
  })
}

function parseStart(args: readonly string[]): StartOptions {
  let workspace: string | undefined
  let foreground = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--foreground') {
      foreground = true
      continue
    }
    if (arg === '--workspace') {
      workspace = args[++index]
      if (!workspace) throw new Error('--workspace needs a path')
      continue
    }
    if (arg.startsWith('--workspace=')) {
      workspace = arg.slice('--workspace='.length)
      if (!workspace) throw new Error('--workspace needs a path')
      continue
    }
    throw new Error(`unknown option: ${arg}`)
  }
  return { ...(workspace ? { workspace } : {}), foreground }
}

function parseStatus(args: readonly string[]): { workspace?: string; json: boolean } {
  let workspace: string | undefined
  let json = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--workspace') {
      workspace = args[++index]
      if (!workspace) throw new Error('--workspace needs a path')
      continue
    }
    if (arg.startsWith('--workspace=')) {
      workspace = arg.slice('--workspace='.length)
      if (!workspace) throw new Error('--workspace needs a path')
      continue
    }
    throw new Error('usage: clara runner status [--workspace <path>] [--json]')
  }
  return { ...(workspace ? { workspace } : {}), json }
}

function parseLogs(args: readonly string[]): LogOptions {
  let lines = 80
  let follow = true
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--no-follow') {
      follow = false
      continue
    }
    if (arg === '--tail' || arg === '--lines') {
      const value = args[++index]
      if (!value) throw new Error(`${arg} needs a number`)
      lines = positive(value)
      continue
    }
    if (arg.startsWith('--tail=') || arg.startsWith('--lines=')) {
      lines = positive(arg.slice(arg.indexOf('=') + 1))
      continue
    }
    throw new Error(`unknown option: ${arg}`)
  }
  return { lines, follow }
}

function positive(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`invalid line count: ${value}`)
  return parsed
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (!alive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return !alive(pid)
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
