import { hostname } from 'node:os'
import { resolve } from 'node:path'
import {
  RunnerClient,
  createRunner,
  engineToken,
  engineURL,
  runnerSnapshots,
  type RunnerSnapshot,
} from '@clara/runner'
import {
  listRunnerChildren,
  readRunnerDesired,
  runnerLogPath,
  stopRunnerChildren,
  writeRunnerDesired,
  type RunnerDesired,
} from './runner-supervisor.ts'
import type { AdapterVerifyCheck } from './cli.ts'
import type { AdapterPaths } from './types.ts'

/**
 * `clara-adapter-<kind> runner <status|start|stop>` manages the script runners
 * on this machine without the packaged `clara` command. The adapter daemon
 * owns the runner processes: start and stop edit the desired state the daemon
 * reconciles, and status combines the engine's live registrations with the
 * children this adapter manages.
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
    await requestRunner(options, rest)
    return
  }
  if (sub === 'stop') {
    await releaseRunner(options, rest)
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
  clara-adapter-${name} runner stop [--workspace <path>]

The adapter daemon supervises exactly one runner per workspace on this
machine. Start records the workspace in the daemon's desired state and the
daemon starts the child within seconds; stop removes it and terminates the
child. Status lists the engine's runner registrations with age against the
engine's stale window.`
}

type StatusReport = {
  engine: { url: string; reachable: boolean; error: string | null }
  workspace?: string
  runners: RunnerSnapshot[]
  managed: { workspace: string; pid: number; running: boolean }[]
  desired: string[]
  log: string
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
  const managed = listRunnerChildren(paths).map((child) => ({
    workspace: child.workspace,
    pid: child.pid,
    running: isAlive(child.pid),
  }))
  return {
    engine: { url, reachable, error },
    ...(options.workspace ? { workspace: options.workspace } : {}),
    runners,
    managed,
    desired: readRunnerDesired(paths).map((entry) => entry.path),
    log: runnerLogPath(paths),
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
  if (report.managed.length === 0 && report.desired.length === 0) {
    console.log('managed:  this adapter supervises no runners')
  } else {
    console.log('managed:')
    for (const child of report.managed) {
      console.log(
        `  ${child.running ? `running (pid ${child.pid})` : 'exited  '}  ${child.workspace}`
      )
    }
    for (const workspace of report.desired) {
      if (!report.managed.some((child) => child.workspace === workspace)) {
        console.log(`  wanted      ${workspace}`)
      }
    }
  }
  console.log(`log:      ${report.log}`)
}

/**
 * `runner start` records the workspace in the daemon's desired state. The
 * daemon's reconcile loop starts (or adopts) the supervised child; this
 * command never spawns a runner itself.
 */
async function requestRunner(
  options: { name: string; paths: AdapterPaths },
  args: string[]
): Promise<void> {
  const { workspace, concurrency, labels } = parseStartArgs(args)
  const target = resolve(workspace ?? process.cwd())
  if (!engineToken()) {
    throw new Error(
      `No engine endpoint is published. Start the adapter daemon with \`clara-adapter-${options.name} start\`.`
    )
  }
  const desired = readRunnerDesired(options.paths)
  const entry: RunnerDesired = {
    path: target,
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(labels.length ? { labels } : {}),
  }
  const index = desired.findIndex((existing) => existing.path === target)
  if (index >= 0) desired[index] = entry
  else desired.push(entry)
  writeRunnerDesired(options.paths, desired)
  console.log(`The adapter daemon now supervises the runner for ${target}.`)
  console.log(`Logs: ${runnerLogPath(options.paths)}`)
}

/** `runner stop` removes the workspace from desired state and ends its child. */
async function releaseRunner(
  options: { name: string; paths: AdapterPaths },
  args: string[]
): Promise<void> {
  const { workspace } = parseStopArgs(args)
  const target = workspace ? resolve(workspace) : undefined
  const desired = readRunnerDesired(options.paths).filter(
    (entry) => target === undefined || entry.path !== target
  )
  writeRunnerDesired(options.paths, desired)
  const stopped = await stopRunnerChildren(options.paths, target ? { workspace: target } : {})
  if (stopped.length === 0 && target) {
    console.log(`No runner child is running for ${target}.`)
    return
  }
  const where = target ? ` for ${target}` : ''
  console.log(
    stopped.length
      ? `Stopped ${stopped.length} runner child(ren)${where}.`
      : `Removed the runner${where} from the daemon's desired state.`
  )
}

/**
 * Hidden `__runner` command: the daemon-supervised runner child. It
 * re-resolves the engine endpoint per request so a daemon restart (new
 * gateway port and token) does not kill it.
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

function parseStopArgs(args: string[]): { workspace?: string } {
  let workspace: string | undefined
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
    throw new Error('usage: runner stop [--workspace <path>]')
  }
  return { ...(workspace ? { workspace } : {}) }
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
