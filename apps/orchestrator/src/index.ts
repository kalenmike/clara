#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  analyzeDatabaseFile,
  summarizeDiagnostics,
  Runtime,
  Store,
  type DiagnosticsResult,
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
  readPidState,
  startDockerService,
  startLocalService,
  statusExitCode,
  stdDir,
  stopService,
  tokenPath,
  workspace,
} from '@clara/orchestration-control'
import { createOrchestratorServer } from './server.ts'

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
    ...(stdDir() ? { stdDir: stdDir() } : {}),
    stalledMs: Number(process.env.CLARA_ORCHESTRATION_STALLED_MS ?? 5 * 60_000),
    leaseMs: Number(process.env.CLARA_ORCHESTRATION_LEASE_MS ?? 30 * 60_000),
    runnerWaitMs: Number(process.env.CLARA_RUNNER_WAIT_MS ?? 60_000),
  })
  const token = ensureToken()
  const app = createOrchestratorServer({
    runtime,
    token,
    host: host(),
    port: port(),
    workspace: workspace(),
    ...(stdDir() ? { stdDir: stdDir() } : {}),
    ...(configPath() ? { configPath: configPath() } : {}),
  })
  writePid()
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(port(), host(), () => resolve())
  })
  console.log(`[clara-orchestrator] listening on ${baseURL()}`)
  console.log(`[clara-orchestrator] database ${dbPath()}`)
  console.log(`[clara-orchestrator] workspace ${workspace()}`)
  console.log(
    `[clara-orchestrator] token file ${process.env.CLARA_ORCHESTRATION_TOKEN_FILE ?? 'default'}`
  )
  console.log('[clara-orchestrator] MCP endpoint /mcp, REST /v1, events /v1/events')
  const shutdown = async () => {
    console.log('[clara-orchestrator] shutting down')
    await app.close()
    store.db.close()
    removePid()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

async function startDocker(build: boolean): Promise<void> {
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
    console.log('stop it with `pnpm clara orchestration stop` before starting the container')
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
  console.error('check `docker compose -f docker/compose.yml logs orchestrator`')
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
      console.log('stop it with `pnpm clara orchestration stop --docker`')
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
    console.log('stop it with `pnpm clara orchestration stop --docker`')
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
      'stop it where it was started, or use `pnpm clara orchestration stop --docker` for the compose service'
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
  const configured = process.env.CLARA_ORCHESTRATION_TOKEN?.trim()
  if (configured) return configured
  const path = process.env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim() || tokenPath()
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return ''
  }
}

function serviceURL(): string {
  return (process.env.CLARA_ORCHESTRATION_URL?.trim() || baseURL()).replace(/\/$/, '')
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
        `  clara-orchestrator ${selected.usage}`,
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
      'Clara orchestration service',
      '',
      'Usage:',
      '  clara-orchestrator <command> [options]',
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
  if (command === 'token') {
    console.log(ensureToken())
    return
  }
  console.error(`unknown command: ${command}`)
  renderHelp()
  process.exitCode = 1
}

void main().catch((error) => {
  console.error(`[clara-orchestrator] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
