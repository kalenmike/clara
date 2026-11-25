import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  RunnerClient,
  createRunner,
  engineToken,
  engineURL,
  runnerSnapshots,
  type RunnerSnapshot,
} from '@clara/runner'
import { selfCommand, selfEntry } from './service.ts'
import type { AdapterVerifyCheck } from './cli.ts'
import type { AdapterPaths } from './types.ts'

/**
 * `clara-adapter-<kind> runner <status|start|stop>` manages a script runner
 * on this machine without the packaged `clara` command. Status reads the
 * engine's live registrations; start spawns a runner child that follows the
 * adapter daemon's published engine endpoint.
 */
export async function runnerCommand(
  options: { name: string; paths: AdapterPaths },
  args: string[]
): Promise<void> {
  const [sub = 'status', ...rest] = args
  if (sub === 'status') {
    await printRunnerStatus(options, rest)
    return
  }
  if (sub === 'start') {
    await startRunnerProcess(options, rest)
    return
  }
  if (sub === 'stop') {
    await stopRunnerProcess(options.paths)
    return
  }
  if (sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(runnerHelp(options.name))
    return
  }
  throw new Error(
    `unknown runner command: ${sub} (try \`clara-adapter-${options.name} runner help\`)`
  )
}

function runnerHelp(name: string): string {
  return `Script runner for the ${name} adapter

Usage:
  clara-adapter-${name} runner status [--workspace <path>] [--json]
  clara-adapter-${name} runner start [--workspace <path>] [--concurrency <n>] [--label <label>]
  clara-adapter-${name} runner stop

Status lists the runner registrations the engine holds, with age against the
engine's stale window. Start spawns a background runner that follows the
adapter daemon's engine endpoint; the harness may already run an embedded
runner for its own workspace.`
}

function runnerPidPath(paths: AdapterPaths): string {
  return join(paths.dataDir, 'runner.pid')
}

function runnerLogPath(paths: AdapterPaths): string {
  return join(paths.dataDir, 'runner.log')
}

function readRunnerPid(paths: AdapterPaths): number | undefined {
  try {
    const value = Number.parseInt(readFileSync(runnerPidPath(paths), 'utf8').trim(), 10)
    return Number.isInteger(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function localRunner(paths: AdapterPaths): { running: boolean; pid?: number } {
  const pid = readRunnerPid(paths)
  if (pid === undefined) return { running: false }
  return isAlive(pid) ? { running: true, pid } : { running: false, pid }
}

type StatusReport = {
  engine: { url: string; reachable: boolean; error: string | null }
  workspace?: string
  runners: RunnerSnapshot[]
  local: { running: boolean; pid: number | null; log: string }
}

async function collectRunnerStatus(
  paths: AdapterPaths,
  options: { workspace?: string }
): Promise<StatusReport> {
  const url = engineURL()
  const token = engineToken()
  let reachable = false
  let error: string | null = null
  let runners: RunnerSnapshot[] = []
  if (!token) {
    error = 'no engine endpoint published; start the adapter daemon first'
  } else {
    try {
      const client = new RunnerClient({ url, token, timeoutMs: 2_000 })
      const rows = await client.adapters(options.workspace)
      runners = runnerSnapshots(rows)
      reachable = true
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }
  const local = localRunner(paths)
  return {
    engine: { url, reachable, error },
    ...(options.workspace ? { workspace: options.workspace } : {}),
    runners,
    local: { running: local.running, pid: local.pid ?? null, log: runnerLogPath(paths) },
  }
}

async function printRunnerStatus(
  options: { name: string; paths: AdapterPaths },
  args: string[]
): Promise<void> {
  const { workspace, json } = parseStatusArgs(args)
  const report = await collectRunnerStatus(options.paths, workspace ? { workspace } : {})
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`engine:   ${report.engine.url}${report.engine.reachable ? '' : ' (unreachable)'}`)
  if (report.engine.error) console.log(`          ${report.engine.error}`)
  if (workspace) console.log(`workspace: ${workspace}`)
  if (report.runners.length === 0) {
    console.log('runners:  none registered')
  } else {
    console.log('runners:')
    for (const runner of report.runners) {
      const age = formatAge(runner.ageMs)
      const state = runner.live ? `live  ${age}` : `stale ${age}`
      const machine = runner.machine ? ` @${runner.machine}` : ''
      console.log(`  ${state}  ${runner.workspace}${machine}  ${runner.id}`)
    }
  }
  console.log(
    `local:    ${report.local.running ? `runner running (pid ${report.local.pid})` : 'no runner started from this adapter'}`
  )
  console.log(`log:      ${report.local.log}`)
}

async function startRunnerProcess(
  options: { name: string; paths: AdapterPaths },
  args: string[]
): Promise<void> {
  const { workspace, concurrency, labels } = parseStartArgs(args)
  const target = resolve(workspace ?? process.cwd())
  const current = localRunner(options.paths)
  if (current.running) {
    console.log(`The runner is already running (pid ${current.pid}).`)
    return
  }
  if (!engineToken()) {
    throw new Error(
      `No engine endpoint is published. Start the adapter daemon with \`clara-adapter-${options.name} start\`.`
    )
  }
  rmRunnerPid(options.paths)
  mkdirSync(dirname(options.paths.logPath), { recursive: true, mode: 0o700 })
  const log = openSync(runnerLogPath(options.paths), 'a', 0o600)
  try {
    const childArgs = ['--workspace', target]
    if (concurrency !== undefined) childArgs.push('--concurrency', String(concurrency))
    for (const label of labels) childArgs.push('--label', label)
    const child = spawn(process.execPath, selfCommand(selfEntry(), '__runner', childArgs), {
      detached: true,
      stdio: ['ignore', log, log],
      env: process.env,
      windowsHide: true,
    })
    child.unref()
    if (child.pid === undefined) throw new Error('Could not start the runner process.')
    mkdirSync(options.paths.dataDir, { recursive: true, mode: 0o700 })
    writeFileSync(runnerPidPath(options.paths), `${child.pid}\n`, { mode: 0o600 })
    console.log(`Started the runner (pid ${child.pid}) for ${target}.`)
    console.log(`Logs: ${runnerLogPath(options.paths)}`)
  } finally {
    closeSync(log)
  }
}

async function stopRunnerProcess(paths: AdapterPaths): Promise<void> {
  const current = localRunner(paths)
  if (!current.running || current.pid === undefined) {
    rmRunnerPid(paths)
    console.log('The runner is not running.')
    return
  }
  try {
    process.kill(current.pid, 'SIGTERM')
  } catch {
    rmRunnerPid(paths)
    console.log('The runner is not running.')
    return
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline && isAlive(current.pid)) {
    await new Promise((done) => setTimeout(done, 100))
  }
  rmRunnerPid(paths)
  if (isAlive(current.pid)) {
    console.error(`The runner (pid ${current.pid}) did not stop within 5s.`)
    process.exitCode = 1
    return
  }
  console.log(`Stopped the runner (pid ${current.pid}).`)
}

function rmRunnerPid(paths: AdapterPaths): void {
  rmSync(runnerPidPath(paths), { force: true })
}

/**
 * Hidden `__runner` command: the detached runner child. It re-resolves the
 * engine endpoint per request so a daemon restart (new gateway port and
 * token) does not kill it.
 */
export async function serveRunnerProcess(name: string, args: string[]): Promise<void> {
  const { workspace, concurrency, labels } = parseStartArgs(args)
  const target = resolve(workspace ?? process.cwd())
  const runner = createRunner({
    url: engineURL(),
    token: engineToken(),
    resolve: () => ({ url: engineURL(), token: engineToken() }),
    workspace: target,
    id: `clara-runner-${name}-${hostname()}-${process.pid}`,
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(labels.length ? { labels } : {}),
  })
  await runner.start()
  console.log(`[clara-runner] ${runner.id} serving ${target}`)
  const stop = () => {
    void runner.stop().then(() => process.exit(0))
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}

function parseStatusArgs(args: string[]): { workspace?: string; json: boolean } {
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
    throw new Error('usage: runner status [--workspace <path>] [--json]')
  }
  return { ...(workspace ? { workspace } : {}), json }
}

function parseStartArgs(args: string[]): {
  workspace?: string
  concurrency?: number
  labels: string[]
} {
  let workspace: string | undefined
  let concurrency: number | undefined
  const labels: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
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
    if (arg === '--concurrency') {
      const value = Number.parseInt(args[++index] ?? '', 10)
      if (!Number.isInteger(value) || value <= 0) throw new Error('--concurrency needs a number')
      concurrency = value
      continue
    }
    if (arg === '--label') {
      const label = args[++index]
      if (!label) throw new Error('--label needs a value')
      labels.push(label)
      continue
    }
    throw new Error(
      'usage: runner start [--workspace <path>] [--concurrency <n>] [--label <label>]'
    )
  }
  return { ...(workspace ? { workspace } : {}), ...(concurrency ? { concurrency } : {}), labels }
}

/**
 * Verify check: the workspace being verified must have a live runner
 * registration on the engine, otherwise script steps cannot run there.
 */
export async function verifyRunnerCheck(options: {
  paths: AdapterPaths
  directory?: string
}): Promise<AdapterVerifyCheck> {
  const directory = resolve(options.directory ?? process.cwd())
  const url = engineURL()
  const token = engineToken()
  if (!token) {
    return {
      name: 'runner',
      status: 'skip',
      detail: 'no engine endpoint published; start the adapter daemon first',
    }
  }
  let runners: RunnerSnapshot[]
  try {
    const client = new RunnerClient({ url, token, timeoutMs: 2_000 })
    runners = runnerSnapshots(await client.adapters())
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return { name: 'runner', status: 'fail', detail: `engine unreachable at ${url}: ${message}` }
  }
  const live = runners.filter((runner) => runner.live)
  const here = live.filter((runner) => runner.workspace === directory)
  if (here.length > 0) {
    return {
      name: 'runner',
      status: 'ok',
      detail: `${here[0].id} live for ${directory}`,
      data: { runners: here.map((runner) => ({ id: runner.id, workspace: runner.workspace })) },
    }
  }
  const elsewhere = live.map((runner) => runner.workspace)
  const detail = elsewhere.length
    ? `no live runner for ${directory}; live runners serve ${elsewhere.join(', ')}`
    : `no runner registered with the engine at ${url}`
  return {
    name: 'runner',
    status: 'fail',
    detail,
    ...(elsewhere.length ? { data: { live: elsewhere } } : {}),
  }
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms)) return 'never'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}
