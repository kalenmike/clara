#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { closeSync, openSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Runtime, Store } from '@clara/orchestration'
import {
  baseURL,
  configPath,
  dbPath,
  ensureToken,
  host,
  logPath,
  pidPath,
  port,
  stdDir,
  workspace,
} from './config.ts'
import {
  collectStatus,
  formatStatus,
  probeHealth,
  readPidState,
  startDockerService,
  statusExitCode,
  stopService,
} from './lifecycle.ts'
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
    stalledMs: Number(process.env.CLARA_ORCHESTRATION_STALLED_MS ?? 30_000),
    leaseMs: Number(process.env.CLARA_ORCHESTRATION_LEASE_MS ?? 30 * 60_000),
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

  const probe = await probeHealth()
  const pid = readPidState()
  if (probe.status === 'current') {
    if (probe.mode === 'container') {
      console.log(`already running in a container at ${baseURL()}`)
      console.log('stop it with `pnpm docker:orchestrator:down`')
      return
    }
    if (
      pid.alive &&
      pid.pid !== null &&
      (probe.mode === 'unknown' || probe.pid === null || probe.pid === pid.pid)
    ) {
      console.log(`already running at ${baseURL()} (pid ${pid.pid})`)
      return
    }
    console.log(`already running at ${baseURL()}; not starting another instance`)
    return
  }
  if (probe.status === 'foreign') {
    throw new Error(`another service is already using ${baseURL()}`)
  }

  const out = openSync(logPath(), 'a', 0o600)
  const [executable, ...execArgs] = selfCommand()
  const child = spawn(executable, [...execArgs, 'serve', '--detached'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env },
  })
  closeSync(out)
  child.unref()
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const next = await probeHealth()
    if (next.status === 'current') {
      console.log(`started at ${baseURL()}`)
      return
    }
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
    console.log(
      'stop it with `pnpm docker:orchestrator:down`, or run `pnpm clara orchestration stop --docker`'
    )
    process.exitCode = 1
    return
  }
  if (result.kind === 'container-down') {
    if (result.result.ok) {
      console.log('stopped the docker container')
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
      'stop it where it was started, or use `pnpm docker:orchestrator:down` for the compose service'
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
