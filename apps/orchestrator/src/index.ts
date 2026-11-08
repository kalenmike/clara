#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
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
import { createOrchestratorServer } from './server.ts'

function health(): Promise<boolean> {
  return fetch(`${baseURL()}/health`)
    .then((response) => response.ok)
    .catch(() => false)
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

async function start(): Promise<void> {
  if (await health()) {
    console.log(`already running at ${baseURL()}`)
    return
  }
  const out = openSync(logPath(), 'a', 0o600)
  const [command, ...args] = selfCommand()
  const child = spawn(command, [...args, 'serve', '--detached'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env },
  })
  closeSync(out)
  child.unref()
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (await health()) {
      console.log(`started at ${baseURL()}`)
      return
    }
  }
  throw new Error(`service did not become healthy; see ${logPath()}`)
}

async function stop(): Promise<void> {
  if (!existsSync(pidPath())) {
    console.log('not running')
    return
  }
  const pid = Number(readFileSync(pidPath(), 'utf8').trim())
  if (!Number.isInteger(pid) || pid <= 0) {
    removePid()
    console.log('removed invalid pid file')
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
    console.log(`stopped pid ${pid}`)
  } catch {
    console.log('process already stopped')
  }
  removePid()
}

async function status(): Promise<void> {
  const running = await health()
  const pid = existsSync(pidPath()) ? readFileSync(pidPath(), 'utf8').trim() : 'none'
  console.log(`service: ${running ? 'running' : 'stopped'}`)
  console.log(`url: ${baseURL()}`)
  console.log(`pid: ${pid}`)
  console.log(`database: ${dbPath()}`)
  if (!running) process.exitCode = 1
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'serve'
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(
      'Clara orchestration service\n\nUsage: clara-orchestrator <serve|start|stop|status|token>'
    )
    return
  }
  if (command === 'serve') return serve()
  if (command === 'start') return start()
  if (command === 'stop') return stop()
  if (command === 'status') return status()
  if (command === 'token') {
    console.log(ensureToken())
    return
  }
  console.error(`unknown command: ${command}`)
  console.error('usage: clara-orchestrator <serve|start|stop|status|token>')
  process.exit(1)
}

void main().catch((error) => {
  console.error(`[clara-orchestrator] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
