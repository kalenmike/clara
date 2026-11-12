import { parseArgs } from 'node:util'

export type HarnessName = 'opencode' | 'claudecode' | 'codex'

export const HARNESSES: HarnessName[] = ['opencode', 'claudecode', 'codex']
export const INSTALLABLE: HarnessName[] = ['opencode']

export interface Options {
  command: string
  harnesses: HarnessName[]
  mcp: boolean
  mcpFor: HarnessName[]
  runner: boolean
  noRunner: boolean
  noService: boolean
  noDaemon: boolean
  purge: boolean
  pair?: string
  opencodeUrl?: string
  opencodeUsername?: string
  opencodePassword?: string
  foreground: boolean
  lines?: number
  workspace?: string
  url?: string
  concurrency?: number
  labels: string[]
  force: boolean
  json: boolean
  dryRun: boolean
  help: boolean
}

export class UsageError extends Error {
  readonly code = 'usage'

  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

function harness(value: string): HarnessName {
  const name = value.trim().toLowerCase()
  if ((HARNESSES as string[]).includes(name)) return name as HarnessName
  throw new UsageError(`unknown harness: ${value}`)
}

function unique(values: HarnessName[]): HarnessName[] {
  return [...new Set(values)]
}

export function parseOptions(argv: string[]): Options {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      opencode: { type: 'boolean', default: false },
      claudecode: { type: 'boolean', default: false },
      codex: { type: 'boolean', default: false },
      mcp: { type: 'boolean', default: false },
      'mcp-for': { type: 'string', multiple: true, default: [] },
      runner: { type: 'boolean', default: false },
      'no-runner': { type: 'boolean', default: false },
      'no-service': { type: 'boolean', default: false },
      'no-daemon': { type: 'boolean', default: false },
      purge: { type: 'boolean', default: false },
      pair: { type: 'string' },
      'opencode-url': { type: 'string' },
      'opencode-username': { type: 'string' },
      'opencode-password': { type: 'string' },
      foreground: { type: 'boolean', default: false },
      lines: { type: 'string' },
      workspace: { type: 'string' },
      url: { type: 'string' },
      concurrency: { type: 'string' },
      label: { type: 'string', multiple: true, default: [] },
      force: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })

  const command = positionals[0] ?? (values.help ? 'help' : '')
  const positionalHarnesses = positionals.slice(1).map(harness)
  const harnesses = unique([
    ...(values.opencode ? (['opencode'] as HarnessName[]) : []),
    ...(values.claudecode ? (['claudecode'] as HarnessName[]) : []),
    ...(values.codex ? (['codex'] as HarnessName[]) : []),
    ...positionalHarnesses,
  ])
  const mcpFor = unique(values['mcp-for'].map(harness))
  const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency)
  if (concurrency !== undefined && (!Number.isFinite(concurrency) || concurrency < 1)) {
    throw new UsageError('--concurrency must be a positive number')
  }
  if (values['no-runner'] && values.runner) {
    throw new UsageError('--runner and --no-runner cannot be combined')
  }

  return {
    command,
    harnesses,
    mcp: values.mcp,
    mcpFor,
    runner: values.runner,
    noRunner: values['no-runner'],
    noService: values['no-service'] || values.foreground,
    noDaemon: values['no-daemon'],
    purge: values.purge,
    ...(values.pair ? { pair: values.pair } : {}),
    ...(values['opencode-url'] ? { opencodeUrl: values['opencode-url'] } : {}),
    ...(values['opencode-username'] ? { opencodeUsername: values['opencode-username'] } : {}),
    ...(values['opencode-password'] ? { opencodePassword: values['opencode-password'] } : {}),
    foreground: values.foreground,
    ...(values.lines ? { lines: Number(values.lines) } : {}),
    ...(values.workspace ? { workspace: values.workspace } : {}),
    ...(values.url ? { url: values.url } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    labels: values.label,
    force: values.force,
    json: values.json,
    dryRun: values['dry-run'],
    help: values.help,
  }
}

export function helpText(): string {
  return `Clara harness adapter installer

Usage:
  clara-adapter install [--opencode] [--pair <code>] [--mcp] [--runner] [options]
  clara-adapter uninstall [--opencode] [--runner]
  clara-adapter status [--json]
  clara-adapter start|stop [--opencode]
  clara-adapter logs [--opencode] [--lines <n>]
  clara-adapter runner [--once] [--workspace <path>] [options]

Harnesses:
  --opencode              Install the OpenCode adapter
  --claudecode            Install the Claude Code adapter (not yet available)
  --codex                 Install the Codex adapter (not yet available)

Features:
  --mcp                   Register the MCP bridge with every selected harness
  --mcp-for <harness>     Register the MCP bridge with one harness; repeatable
  --runner                Install the shared standalone runner (default with a harness)
  --no-runner             Do not install a runner
  --no-service            Write runner config but do not install a user service
  --no-daemon             Install only the orchestration binding, not the hub adapter
  --foreground            Print the foreground runner command instead of a service
  --pair <code>           Pair the harness adapter with the hub
  --opencode-url <url>    OpenCode URL for the adapter
  --opencode-username <u> OpenCode username (default opencode)
  --opencode-password <p> OpenCode password for the adapter

Connection:
  --workspace <path>      Workspace for the runner (default: CLARA_ORCHESTRATION_WORKSPACE or cwd)
  --url <url>             Orchestrator URL (default: CLARA_ORCHESTRATION_URL or http://127.0.0.1:8789)
  --concurrency <n>       Concurrent script jobs (default: 2)
  --label <name>          Runner label; repeatable

Other:
  --force                 Replace files this installer did not generate
  --purge                 Remove the adapter identity and credential on uninstall
  --dry-run               Print the plan without writing anything
  --json                  Machine-readable status output
  -h, --help              Show this help

Examples:
  clara-adapter install --opencode
  clara-adapter install --opencode --mcp
  clara-adapter install --opencode --claudecode --mcp-for opencode
  clara-adapter install --runner --mcp
  clara-adapter runner --once --workspace .
  clara-adapter uninstall --opencode
`
}
