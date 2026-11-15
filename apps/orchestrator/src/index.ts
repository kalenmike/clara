#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  analyzeDatabaseFile,
  buildEvidence,
  readRunEvidenceFile,
  runIdFromRequest,
  summarizeDiagnostics,
  Runtime,
  Store,
  type AlertRow,
  type DiagnosticsResult,
  type RunEvidence,
  type RunRow,
  type StepAttemptRow,
  type StepRow,
} from '@clara/orchestration'
import {
  baseURL,
  collectStatus,
  configPath,
  dbPath,
  ensureToken,
  formatStatus,
  host,
  logPath,
  pidPath,
  port,
  readComposeLogs,
  readPidState,
  startDockerService,
  startLocalService,
  statusExitCode,
  stopService,
  tokenPath,
  workspace,
} from '@clara/service-control'
import { createEngineServer } from './server.ts'

/** Read a Clara engine variable, falling back to its historical name. */
function engineEnv(name: string, legacy: string): string | undefined {
  return process.env[name]?.trim() || process.env[legacy]?.trim()
}

function selfCommand(): string[] {
  const entry = fileURLToPath(import.meta.url)
  if (entry.endsWith('.ts')) {
    return [process.execPath, '--experimental-strip-types', '--no-warnings', entry]
  }
  return [process.execPath, entry]
}

function writePid(): void {
  writeFileSync(pidPath(), `${process.pid}\n`, { mode: 0o600 })
}

function removePid(): void {
  try {
    unlinkSync(pidPath())
  } catch {
    // Already gone.
  }
}

async function serve(): Promise<void> {
  const store = new Store(dbPath())
  const runtime = new Runtime({
    store,
    ...(configPath() ? { configPath: configPath() } : {}),
    stalledMs: Number(
      engineEnv('CLARA_ENGINE_STALLED_MS', 'CLARA_ORCHESTRATION_STALLED_MS') ?? 5 * 60_000
    ),
    leaseMs: Number(
      engineEnv('CLARA_ENGINE_LEASE_MS', 'CLARA_ORCHESTRATION_LEASE_MS') ?? 30 * 60_000
    ),
    runnerWaitMs: Number(process.env.CLARA_RUNNER_WAIT_MS ?? 60_000),
  })
  const token = ensureToken()
  const app = createEngineServer({
    runtime,
    token,
    host: host(),
    port: port(),
    workspace: workspace(),
    ...(configPath() ? { configPath: configPath() } : {}),
  })
  writePid()
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(port(), host(), () => resolve())
  })
  console.log(`[clara-engine] listening on ${baseURL()}`)
  console.log(`[clara-engine] database ${dbPath()}`)
  console.log(`[clara-engine] workspace ${workspace()}`)
  console.log(
    `[clara-engine] token file ${engineEnv('CLARA_ENGINE_TOKEN_FILE', 'CLARA_ORCHESTRATION_TOKEN_FILE') ?? 'default'}`
  )
  console.log('[clara-engine] MCP endpoint /mcp, REST /v1, events /v1/events')
  const shutdown = async () => {
    console.log('[clara-engine] shutting down')
    await app.close()
    store.db.close()
    removePid()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

async function startDocker(build: boolean): Promise<void> {
  console.log(`checking the orchestrator container at ${baseURL()}/health`)
  const result = await startDockerService({ build })
  if (result.kind === 'container-started') {
    console.log(`started docker container at ${baseURL()}`)
    return
  }
  if (result.kind === 'container-running') {
    console.log(`already running in a container at ${baseURL()}`)
    return
  }
  if (result.kind === 'local-running') {
    const pid = result.pid === null ? '' : ` (pid ${result.pid})`
    console.log(`a local orchestrator is running at ${baseURL()}${pid}`)
    console.log('stop it with `pnpm clara stop orchestrator` before starting the container')
    process.exitCode = 1
    return
  }
  if (result.kind === 'external') {
    console.log(`an orchestrator is already running at ${baseURL()} from another data directory`)
    console.log('stop it before starting the container')
    process.exitCode = 1
    return
  }
  if (result.kind === 'foreign') {
    console.log(`another service is using ${baseURL()}; not starting the container`)
    process.exitCode = 1
    return
  }
  if (result.kind === 'compose-failed') {
    if (result.result.error) console.error(`could not run docker: ${result.result.error}`)
    else console.error(`docker compose up failed (exit ${result.result.code ?? 'unknown'})`)
    process.exitCode = 1
    return
  }
  console.error(`the docker container did not become healthy at ${baseURL()}`)
  const logs = readComposeLogs()
  if (logs) {
    console.error('recent container logs:')
    for (const line of logs.split('\n')) console.error(`  ${line}`)
  }
  console.error('check `docker compose -f infra/docker/orchestrator.compose.yml logs orchestrator`')
  process.exitCode = 1
}

async function start(args: string[]): Promise<void> {
  const docker = args.includes('--docker')
  const build = args.includes('--build')
  if (build && !docker) {
    console.error('--build requires --docker')
    process.exitCode = 1
    return
  }
  if (docker) return startDocker(build)

  const result = await startLocalService({ command: selfCommand() })
  if (result.kind === 'started') {
    console.log(`started at ${baseURL()}`)
    return
  }
  if (result.kind === 'already-running') {
    if (result.mode === 'container') {
      console.log(`already running in a container at ${baseURL()}`)
      console.log('stop it with `pnpm clara stop orchestrator --docker`')
      return
    }
    const pid = readPidState()
    if (pid.alive && pid.pid !== null) {
      console.log(`already running at ${baseURL()} (pid ${pid.pid})`)
      return
    }
    console.log(`already running at ${baseURL()}; not starting another instance`)
    return
  }
  if (result.kind === 'unresponsive') {
    throw new Error(
      `the process at ${baseURL()} (pid ${result.pid}) is not answering; see ${logPath()}`
    )
  }
  if (result.kind === 'foreign') {
    throw new Error(`another service is already using ${baseURL()}`)
  }
  throw new Error(`service did not become healthy; see ${logPath()}`)
}

async function stop(args: string[]): Promise<void> {
  const result = await stopService({ docker: args.includes('--docker') })
  if (result.kind === 'stopped') {
    console.log(`stopped pid ${result.pid}`)
    return
  }
  if (result.kind === 'already-stopped') {
    console.log(
      result.stalePid === null
        ? 'not running'
        : `not running (removed stale pid file for pid ${result.stalePid})`
    )
    return
  }
  if (result.kind === 'not-exited') {
    console.log(`pid ${result.pid} is still running after SIGTERM`)
    process.exitCode = 1
    return
  }
  if (result.kind === 'container') {
    console.log(`the orchestrator is running in a Docker container at ${baseURL()}`)
    console.log('stop it with `pnpm clara stop orchestrator --docker`')
    process.exitCode = 1
    return
  }
  if (result.kind === 'container-down') {
    if (result.result.ok) {
      console.log(
        result.detected
          ? 'stopped the docker container'
          : 'docker compose down completed (no running container was detected)'
      )
      return
    }
    if (result.result.error) console.error(`could not run docker: ${result.result.error}`)
    else console.error(`docker compose down failed (exit ${result.result.code ?? 'unknown'})`)
    process.exitCode = 1
    return
  }
  if (result.kind === 'external') {
    console.log(
      `the orchestrator is running at ${baseURL()} but was not started from this data directory`
    )
    console.log(
      'stop it where it was started, or use `pnpm clara stop orchestrator --docker` for the compose service'
    )
    process.exitCode = 1
    return
  }
  if (result.kind === 'foreign') {
    console.log(`another service is using ${baseURL()}; nothing was stopped`)
    process.exitCode = 1
    return
  }
  console.error(`could not stop the orchestrator: ${result.message}`)
  process.exitCode = 1
}

async function status(): Promise<void> {
  const report = await collectStatus()
  for (const line of formatStatus(report)) console.log(line)
  process.exitCode = statusExitCode(report)
}

interface AnalyzeOptions {
  json: boolean
  days: number
  db?: string
  url?: string
}

function analyzeOptions(args: string[]): AnalyzeOptions | undefined {
  const options: AnalyzeOptions = { json: false, days: 30 }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--days' || arg === '--db' || arg === '--url') {
      const value = args[++index]
      if (!value) return undefined
      if (arg === '--days') {
        const days = Number(value)
        if (!Number.isFinite(days) || days < 0) return undefined
        options.days = days
      } else if (arg === '--db') {
        options.db = value
      } else {
        options.url = value
      }
      continue
    }
    return undefined
  }
  return options
}

function serviceToken(): string {
  const configured = engineEnv('CLARA_ENGINE_TOKEN', 'CLARA_ORCHESTRATION_TOKEN')
  if (configured) return configured
  const path = engineEnv('CLARA_ENGINE_TOKEN_FILE', 'CLARA_ORCHESTRATION_TOKEN_FILE') || tokenPath()
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}

function serviceURL(): string {
  return (engineEnv('CLARA_ENGINE_URL', 'CLARA_ORCHESTRATION_URL') || baseURL()).replace(/\/$/, '')
}

async function serviceHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_500) })
    return response.ok
  } catch {
    return false
  }
}

async function collectDiagnostics(options: AnalyzeOptions): Promise<DiagnosticsResult> {
  const url = (options.url ?? serviceURL()).replace(/\/$/, '')
  const token = serviceToken()
  if (!options.db && (await serviceHealthy(url))) {
    try {
      const params = new URLSearchParams({ days: String(options.days) })
      const response = await fetch(`${url}/v1/diagnostics?${params}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) return (await response.json()) as DiagnosticsResult
    } catch {
      // The service can stop between the health check and the request.
    }
  }

  return analyzeDatabaseFile(options.db ?? dbPath(), { days: options.days })
}

function printDiagnostics(report: DiagnosticsResult): void {
  if (!report.available) {
    console.log(`No orchestrator history available: ${report.reason}`)
    return
  }
  console.log(
    `Orchestrator diagnostics — ${report.window.days > 0 ? `last ${report.window.days} days` : 'all history'}`
  )
  if (report.database?.path) console.log(`database: ${report.database.path}`)
  for (const line of summarizeDiagnostics(report)) console.log(line)
  const pipelines = report.pipelines.filter((entry) => entry.failed > 0).slice(0, 5)
  if (pipelines.length) {
    console.log('failing pipelines:')
    for (const entry of pipelines) {
      console.log(
        `  ${entry.pipeline}: ${entry.failed} failed / ${entry.runs} runs (${entry.failure_rate}%), ${entry.open_alerts} open alerts`
      )
    }
  }
  const steps = report.step_health.filter((entry) => entry.failures > 0).slice(0, 5)
  if (steps.length) {
    console.log('failing steps:')
    for (const entry of steps) {
      console.log(
        `  ${entry.name} [${entry.pipeline}]: ${entry.failures}/${entry.steps} steps failed, ${entry.exhausted} exhausted retries`
      )
    }
  }
  const errors = report.errors.slice(0, 5)
  if (errors.length) {
    console.log('top errors:')
    for (const entry of errors) {
      console.log(`  ${entry.count}x ${entry.category}: ${entry.sample}`)
    }
  }
}

async function analyze(args: string[]): Promise<void> {
  const options = analyzeOptions(args)
  if (!options) {
    renderHelp('analyze')
    process.exitCode = 2
    return
  }
  const report = await collectDiagnostics(options)
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  printDiagnostics(report)
}

interface InspectOptions {
  json: boolean
  runId?: number
  request?: string
  requestEnv?: boolean
  workspace?: string
  db?: string
  url?: string
}

function inspectOptions(args: string[]): InspectOptions | undefined {
  const options: InspectOptions = { json: false }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--request-env') {
      options.requestEnv = true
      continue
    }
    if (
      arg === '--run' ||
      arg === '--request' ||
      arg === '--workspace' ||
      arg === '--db' ||
      arg === '--url'
    ) {
      const value = args[++index]
      if (!value) return undefined
      if (arg === '--run') {
        const runId = Number(value)
        if (!Number.isSafeInteger(runId) || runId < 1) return undefined
        options.runId = runId
      } else if (arg === '--request') {
        options.request = value
      } else if (arg === '--workspace') {
        options.workspace = value
      } else if (arg === '--db') {
        options.db = value
      } else {
        options.url = value
      }
      continue
    }
    return undefined
  }
  return options
}

async function serviceEvidence(
  url: string,
  token: string,
  options: { runId?: number; workspace?: string }
): Promise<RunEvidence | undefined> {
  const get = async (path: string): Promise<unknown> => {
    try {
      const response = await fetch(`${url}${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) return undefined
      return await response.json()
    } catch {
      return undefined
    }
  }

  let run: RunRow | undefined
  if (options.runId !== undefined) {
    const status = (await get(`/v1/runs/${options.runId}`)) as { run?: RunRow } | undefined
    run = status?.run
  } else {
    const runs = (await get('/v1/runs')) as RunRow[] | undefined
    const candidates = (runs ?? []).filter(
      (entry) =>
        entry.state === 'failed' &&
        entry.parent_run_id == null &&
        (!options.workspace ||
          resolveWorkspace(entry.workspace) === resolveWorkspace(options.workspace))
    )
    candidates.sort((left, right) => Number(right.id) - Number(left.id))
    run = candidates[0]
  }
  if (!run) return undefined

  const runID = Number(run.id)
  const [status, attempts] = await Promise.all([
    get(`/v1/runs/${runID}`),
    get(`/v1/runs/${runID}/attempts`),
  ])
  if (!status) return undefined
  const detail = status as {
    run: RunRow
    steps?: StepRow[]
    alerts?: AlertRow[]
    children?: RunRow[]
  }
  return buildEvidence({
    source: 'service',
    run: detail.run,
    root: detail.run,
    steps: detail.steps ?? [],
    attempts: (attempts as StepAttemptRow[] | undefined) ?? [],
    alerts: detail.alerts ?? [],
    children: detail.children ?? [],
  })
}

function resolveWorkspace(path: string): string {
  return path.replace(/\/$/, '')
}

async function collectEvidence(
  options: InspectOptions,
  runId: number | undefined
): Promise<RunEvidence> {
  if (!options.db) {
    const url = (options.url ?? serviceURL()).replace(/\/$/, '')
    if (await serviceHealthy(url)) {
      const evidence = await serviceEvidence(url, serviceToken(), {
        ...(runId !== undefined ? { runId } : {}),
        ...(options.workspace ? { workspace: options.workspace } : { workspace: workspace() }),
      })
      if (evidence) return evidence
    }
  }
  return readRunEvidenceFile(options.db ?? dbPath(), {
    ...(runId !== undefined ? { runId } : {}),
    workspace: options.workspace ?? workspace(),
  })
}

async function inspect(args: string[]): Promise<void> {
  const options = inspectOptions(args)
  if (!options) {
    renderHelp('inspect')
    process.exitCode = 2
    return
  }

  let runId = options.runId
  let reason = runId !== undefined ? 'explicit' : 'latest-failed'
  const requestPath =
    options.request ?? (options.requestEnv ? process.env.CLARA_REQUEST : undefined)
  if (runId === undefined && requestPath) {
    try {
      const parsed = runIdFromRequest(readFileSync(requestPath, 'utf8'))
      if (parsed !== undefined) {
        runId = parsed
        reason = 'request'
      }
    } catch {
      // Fall back to the latest failed run.
    }
  }

  const evidence = await collectEvidence(options, runId)
  if (!evidence.available) {
    if (options.json) console.log(JSON.stringify({ ...evidence, selected: null }, null, 2))
    else console.log(evidence.reason ?? 'no failed run found')
    process.exitCode = 1
    return
  }
  const selected = { run_id: evidence.run?.id ?? null, reason }
  if (options.json) {
    console.log(JSON.stringify({ ...evidence, selected }, null, 2))
    return
  }
  printEvidence(evidence, selected)
}

function printEvidence(
  evidence: RunEvidence,
  selected: { run_id: number | null; reason: string }
): void {
  const run = evidence.run
  if (!run) return
  console.log(`run ${run.id} ${run.pipeline_ref} — ${run.state} (${selected.reason})`)
  console.log(`workspace ${run.workspace}`)
  console.log(`error ${run.error ?? '—'}`)
  if (evidence.failure) {
    console.log(
      `failure ${evidence.failure.step_path} attempt ${evidence.failure.attempt} (${evidence.failure.status}): ${evidence.failure.error ?? 'no error'}`
    )
  }
  console.log('steps:')
  for (const step of evidence.steps) {
    const marker = step.status === 'failed' ? 'fail' : step.status
    console.log(`  ${marker.padEnd(8)} ${step.path} (${step.type})`)
  }
  if (evidence.alerts.length) {
    console.log('alerts:')
    for (const alert of evidence.alerts)
      console.log(`  ${alert.kind}: ${alert.title} — ${alert.body}`)
  }
}

interface HelpOption {
  flags: string
  description: string
}

interface CommandHelp {
  name: string
  summary: string
  usage: string
  options?: HelpOption[]
}

const helpOption: HelpOption = { flags: '-h, --help', description: 'Show help' }

const commandHelp: CommandHelp[] = [
  {
    name: 'serve',
    summary: 'Run the service in the foreground',
    usage: 'serve',
  },
  {
    name: 'start',
    summary: 'Start the service in the background',
    usage: 'start [--docker] [--build]',
    options: [
      {
        flags: '--docker',
        description: 'Start the compose-managed container instead of a local process',
      },
      {
        flags: '--build',
        description: 'Rebuild the image before starting (requires --docker)',
      },
    ],
  },
  {
    name: 'stop',
    summary: 'Stop the running service',
    usage: 'stop [--docker]',
    options: [{ flags: '--docker', description: 'Stop the compose-managed container' }],
  },
  {
    name: 'status',
    summary: 'Show which instance is running',
    usage: 'status',
  },
  {
    name: 'analyze',
    summary: 'Analyze run history for failure patterns',
    usage: 'analyze [--json] [--days <n>] [--db <path>] [--url <url>]',
    options: [
      { flags: '--json', description: 'Print the full report as JSON' },
      {
        flags: '--days <n>',
        description: 'Analysis window in days, 0 for all history (default 30)',
      },
      { flags: '--db <path>', description: 'Read this SQLite database instead of the default' },
      {
        flags: '--url <url>',
        description: 'Read from a running orchestrator instead of the database',
      },
    ],
  },
  {
    name: 'token',
    summary: 'Print the orchestration token',
    usage: 'token',
  },
  {
    name: 'inspect',
    summary: 'Show the evidence for a failed run',
    usage:
      'inspect [--run <id> | --request <path> | --request-env] [--json] [--workspace <path>] [--db <path>] [--url <url>]',
    options: [
      {
        flags: '--run <id>',
        description: 'Inspect this run; defaults to the latest failed root run',
      },
      {
        flags: '--request <path>',
        description: 'Read a run id from a request file, then fall back to the latest failed run',
      },
      {
        flags: '--request-env',
        description: 'Read a run id from CLARA_REQUEST, as a script step does',
      },
      { flags: '--json', description: 'Print the full evidence as JSON' },
      {
        flags: '--workspace <path>',
        description: 'Scope the latest-failed lookup to this workspace',
      },
      { flags: '--db <path>', description: 'Read this SQLite database instead of the service' },
      { flags: '--url <url>', description: 'Read from a running orchestrator' },
    ],
  },
]

function renderHelp(command?: string): boolean {
  const selected = command ? commandHelp.find((item) => item.name === command) : undefined
  if (command && !selected) return false

  if (selected) {
    const options = [...(selected.options ?? []), helpOption]
    const width = Math.max(...options.map((option) => option.flags.length))
    console.log(
      [
        selected.summary,
        '',
        'Usage:',
        `  clara-engine ${selected.usage}`,
        '',
        'Options:',
        ...options.map((option) => `  ${option.flags.padEnd(width)}  ${option.description}`),
      ].join('\n')
    )
    return true
  }

  const width = Math.max(...commandHelp.map((item) => item.name.length), 'help'.length)
  console.log(
    [
      'Clara engine',
      '',
      'Usage:',
      '  clara-engine <command> [options]',
      '',
      'Commands:',
      ...commandHelp.map((item) => `  ${item.name.padEnd(width)}  ${item.summary}`),
      `  ${'help'.padEnd(width)}  Show help for a command`,
      '',
      'Options:',
      `  ${helpOption.flags}  ${helpOption.description}`,
    ].join('\n')
  )
  return true
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help'
  const args = process.argv.slice(3)

  if (command === 'help' || command === '--help' || command === '-h') {
    const target = command === 'help' ? args.find((arg) => !arg.startsWith('-')) : undefined
    if (target && !renderHelp(target)) {
      console.error(`unknown command: ${target}`)
      renderHelp()
      process.exitCode = 1
      return
    }
    if (!target) renderHelp()
    return
  }

  if (args.includes('--help') || args.includes('-h')) {
    if (!renderHelp(command)) {
      console.error(`unknown command: ${command}`)
      renderHelp()
      process.exitCode = 1
    }
    return
  }

  if (command === 'serve') return serve()
  if (command === 'start') return start(args)
  if (command === 'stop') return stop(args)
  if (command === 'status') return status()
  if (command === 'analyze') return analyze(args)
  if (command === 'inspect') return inspect(args)
  if (command === 'token') {
    console.log(ensureToken())
    return
  }
  console.error(`unknown command: ${command}`)
  renderHelp()
  process.exitCode = 1
}

void main().catch((error) => {
  console.error(`[clara-engine] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
