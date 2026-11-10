#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createRunner } from './loop.ts'

function fail(message: string): never {
  console.error(`error ${message}`)
  process.exit(1)
}

function dataDir(): string {
  const configured = process.env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const xdg = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara')
}

function orchestratorURL(): string {
  return (process.env.CLARA_ORCHESTRATION_URL?.trim() || 'http://127.0.0.1:8789').replace(/\/$/, '')
}

function orchestratorToken(): string {
  const configured = process.env.CLARA_ORCHESTRATION_TOKEN?.trim()
  if (configured) return configured
  const path =
    process.env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim() || join(dataDir(), 'orchestrator.token')
  if (!existsSync(path)) {
    fail(`no orchestrator token in the environment or at ${path}`)
  }
  return readFileSync(path, 'utf8').trim()
}

const { values } = parseArgs({
  options: {
    workspace: { type: 'string', short: 'w' },
    url: { type: 'string' },
    token: { type: 'string' },
    id: { type: 'string' },
    label: { type: 'string', multiple: true, default: [] },
    concurrency: { type: 'string', short: 'c' },
    once: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
})

if (values.help) {
  console.log(`Clara script runner

Usage: pnpm clara runner [options]

  --workspace, -w <path>   Workspace to execute in (default: CLARA_ORCHESTRATION_WORKSPACE or cwd)
  --url <url>              Orchestrator URL (default: CLARA_ORCHESTRATION_URL)
  --token <token>          Orchestrator token (default: env or orchestrator.token)
  --id <id>                Stable runner id
  --label <name>           Runner label, repeatable (matches requires.runner)
  --concurrency, -c <n>    Concurrent scripts (default: 2)
  --once                   Claim and run one batch, then exit
  --help, -h               Show this help`)
  process.exit(0)
}

const workspace = resolve(
  values.workspace ?? process.env.CLARA_ORCHESTRATION_WORKSPACE?.trim() ?? process.cwd()
)
const concurrency = Number(values.concurrency ?? 2)
if (!Number.isFinite(concurrency) || concurrency < 1) fail('concurrency must be a positive number')

const runner = createRunner({
  url: values.url ?? orchestratorURL(),
  token: values.token ?? orchestratorToken(),
  workspace,
  concurrency,
  ...(values.id ? { id: values.id } : {}),
  labels: values.label,
  logger: console,
})

if (values.once) {
  const claimed = await runner.once().catch((error: unknown) => {
    fail(error instanceof Error ? error.message : String(error))
  })
  console.log(`[clara-runner] ${claimed} step(s) claimed; ${JSON.stringify(runner.status())}`)
  process.exit(0)
}

await runner.start()
const status = runner.status()
console.log(`[clara-runner] ${status.id} watching ${status.workspace} (concurrency ${concurrency})`)

const stop = async (signal: string): Promise<void> => {
  console.log(`[clara-runner] ${signal}; stopping`)
  await runner.stop()
  process.exit(0)
}
process.on('SIGINT', () => void stop('SIGINT'))
process.on('SIGTERM', () => void stop('SIGTERM'))
