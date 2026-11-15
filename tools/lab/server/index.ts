#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { previewPipeline, type Diagnostic } from '@clara/pipeline-preview'
import {
  ensureEngine,
  labPort,
  labURL,
  openBrowser,
  engineURL,
  readToken,
  startLabServer,
  staticRootCandidates,
  workspace,
  LabRuntime,
} from '@clara/lab-server'

interface Options {
  command: string
  workspace?: string
  target?: string
  configPath?: string
  port?: number
  json: boolean
  open: boolean
}

function parse(args: string[]): Options {
  const options: Options = { command: 'serve', json: false, open: true }
  const positionals: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--json') {
      options.json = true
    } else if (arg === '--no-open' || arg === '--no-browser') {
      options.open = false
    } else if (arg === '--help' || arg === '-h') {
      options.command = 'help'
    } else if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2)
      const value = inline ?? args[++index]
      if (value === undefined) throw new Error(`Missing value for --${name}`)
      if (name === 'workspace') options.workspace = value
      else if (name === 'target') options.target = value
      else if (name === 'config') options.configPath = value
      else if (name === 'port') options.port = Number(value)
      else throw new Error(`Unknown option --${name}`)
    } else {
      positionals.push(arg)
    }
  }
  if (positionals.length) options.command = positionals[0]
  return options
}

function usage(): string {
  return [
    'Clara Lab — pipeline preview and agent probe',
    '',
    'Usage:',
    '  clara-lab [serve] [options]',
    '  clara-lab check [options]',
    '',
    'Options:',
    '  --workspace <path>  Workspace or config path (default: cwd)',
    '  --target <ref>      Pipeline target for check or the initial preview',
    '  --config <path>     Explicit orchestration index.yml',
    '  --port <number>     Lab port (default: 8791)',
    '  --no-open           Do not open a browser',
    '  --json              Machine-readable check output',
  ].join('\n')
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const location =
    diagnostic.path ?? (diagnostic.stepPath ? `step ${diagnostic.stepPath}` : undefined)
  return `  ${diagnostic.severity.padEnd(7)} [${diagnostic.code}] ${diagnostic.message}${
    location ? ` (${location})` : ''
  }`
}

async function check(options: Options): Promise<void> {
  const result = previewPipeline({
    ...(options.workspace ? { workspace: options.workspace } : {}),
    ...(options.target ? { target: options.target } : {}),
    ...(options.configPath ? { configPath: options.configPath } : {}),
  })
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          workspace: result.workspace,
          target: result.selected,
          hash: result.compiled?.hash,
          stats: result.stats,
          diagnostics: result.diagnostics,
        },
        null,
        2
      )
    )
  } else {
    console.log(`workspace: ${result.workspace?.workspace ?? '-'}`)
    console.log(`config:    ${result.workspace?.configPath ?? '-'}`)
    console.log(`target:    ${result.selected?.label ?? '(entry)'}`)
    if (result.compiled) {
      console.log(`hash:      ${result.compiled.hash}`)
      if (result.stats) {
        console.log(
          `steps:     ${result.stats.nodes} nodes, ${result.stats.agents} agents, ${result.stats.scripts} scripts, ${result.stats.routers} routers, ${result.stats.routes} routes`
        )
      }
    }
    if (result.diagnostics.length) {
      console.log('')
      console.log('diagnostics:')
      for (const diagnostic of result.diagnostics) {
        console.log(formatDiagnostic(diagnostic))
      }
    } else {
      console.log('')
      console.log('No diagnostics.')
    }
  }
  if (errors.length) process.exitCode = 1
}

async function labHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`${labURL(port)}api/health`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    })
    if (!response.ok) return false
    const body = (await response.json()) as { service?: unknown }
    return body.service === 'clara-lab'
  } catch {
    return false
  }
}

function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const done = (busy: boolean): void => {
      socket.destroy()
      resolve(busy)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

async function serve(options: Options): Promise<void> {
  const port = options.port ?? labPort()
  if (await labHealth(port)) {
    const url = labURL(port)
    console.log(`Clara Lab is already running at ${url}`)
    if (options.open) openBrowser(url)
    return
  }
  if (await portBusy(port)) {
    throw new Error(
      `Port ${port} is already in use on 127.0.0.1, but it did not answer as Clara Lab. Set CLARA_LAB_PORT or --port.`
    )
  }

  const url = engineURL()
  let token = readToken()
  try {
    await ensureEngine(url)
    token = readToken()
  } catch (error) {
    console.warn(
      `[clara-lab] engine unavailable: ${error instanceof Error ? error.message : String(error)}`
    )
    console.warn('[clara-lab] preview works offline; probe actions will retry when it is up.')
  }

  const runtime = new LabRuntime({
    url,
    token,
    workspace: options.workspace ?? workspace(),
  })
  const staticRoots = staticRootCandidates(dirname(fileURLToPath(import.meta.url)))
  if (!staticRoots.some((root) => existsSync(join(root, 'index.html')))) {
    console.warn('[clara-lab] web UI is not built; run `pnpm build` or use `pnpm dev:lab`.')
  }
  await runtime.start()
  const server = await startLabServer({
    runtime,
    port,
    staticRoots,
    log: (message, detail) => console.error(`[clara-lab] ${message}`, detail ?? ''),
  })

  console.log(`Clara Lab:     ${server.url}`)
  console.log(`workspace:     ${runtime.state.workspace}`)
  console.log(`engine:  ${url} (${runtime.state.connected ? 'connected' : 'offline'})`)
  if (!token) console.warn('[clara-lab] no engine token found; run `clara start engine`')
  if (options.open) openBrowser(server.url)

  const shutdown = async (): Promise<void> => {
    console.log('\n[clara-lab] shutting down')
    await server.close()
    await runtime.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2))
  if (options.command === 'help') {
    console.log(usage())
    return
  }
  if (options.command === 'check' || options.command === 'validate') {
    await check(options)
    return
  }
  if (options.command === 'serve' || options.command === 'start') {
    await serve(options)
    return
  }
  throw new Error(`Unknown command: ${options.command}`)
}

void main().catch((error) => {
  console.error(`[clara-lab] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
