import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { readRunnerConfig, engineURL } from '@clara/runner'
import { join } from 'node:path'
import { resolvePaths } from '../paths.ts'
import { selfCommand } from '../self.ts'
import {
  clearRunnerPid,
  followRunnerLog,
  runnerLogPath,
  runnerPidPath,
  runnerProcess,
  writeRunnerPid,
} from '../state/runner.ts'
import { dim, green } from '../ui/color.ts'
import { success, warn } from '../ui/index.ts'

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
        '  clara runner status [--json]',
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
  const current = runnerProcess(paths)
  if (current.running) {
    console.log(`The runner is already running (pid ${current.pid}).`)
    return 0
  }
  clearRunnerPid(paths)

  const forwarded = options.workspace ? ['--workspace', options.workspace] : []
  const configPath = join(paths.configDir, 'runner.json')
  if (options.foreground) {
    const { serveRunner } = await import('../serve/runner.ts')
    await serveRunner(['--config', configPath, ...forwarded])
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
      env: process.env,
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

/** `clara runner status [--json]` */
export async function runRunnerStatus(args: readonly string[]): Promise<number> {
  if (args.some((arg) => arg !== '--json')) {
    throw new Error('usage: clara runner status [--json]')
  }
  const paths = resolvePaths()
  const current = runnerProcess(paths)
  const configPath = join(paths.configDir, 'runner.json')
  const saved = readRunnerConfig(configPath)
  const workspace =
    saved?.workspace ??
    process.env.CLARA_ENGINE_WORKSPACE?.trim() ??
    process.env.CLARA_ORCHESTRATION_WORKSPACE?.trim() ??
    process.cwd()
  const url = saved?.url ?? engineURL()
  const report = {
    state: current.running ? ('running' as const) : ('stopped' as const),
    pid: current.pid ?? null,
    workspace,
    url,
    concurrency: saved?.concurrency ?? null,
    configPath,
    log: runnerLogPath(paths),
    pidFile: runnerPidPath(paths),
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
    return 0
  }
  console.log(
    `runner:    ${current.running ? green(`running (pid ${current.pid})`) : dim('stopped')}`
  )
  console.log(`workspace: ${workspace ?? dim('(not configured)')}`)
  console.log(`engine:    ${url}`)
  console.log(`config:    ${configPath}`)
  console.log(`log:       ${runnerLogPath(paths)}`)
  return 0
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
