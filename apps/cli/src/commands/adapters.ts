import { join } from 'node:path'
import { AdapterRegistry, ADAPTER_KINDS } from '../adapters/registry.ts'
import {
  detectAdapterTarget,
  UnsupportedPlatformError,
  type AdapterTarget,
} from '../adapters/platform.ts'
import {
  adapterEnv,
  adapterRuntimeState,
  readAdapterState,
  type AdapterInstallRecord,
  type AdapterRuntimeState,
} from '../adapters/state.ts'
import { readAdapterLiveState, type AdapterLiveState } from '../adapters/live.ts'
import { resolvePaths } from '../paths.ts'
import { dim, green } from '../ui/color.ts'
import { formatBytes, heading, muted, stateLabel, warn } from '../ui/index.ts'
import { startSpinner } from '../ui/spinner.ts'
import { renderTable } from '../ui/table.ts'
import { parseAdapterArgs } from './adapter-args.ts'
import { runAdapterInstall, runAdapterRemove, runAdapterUpgrade } from './adapter-install.ts'
import { runAdapterControl, type AdapterControlAction } from './adapter-control.ts'

const CONTROL = new Set<AdapterControlAction>(['start', 'stop', 'status', 'logs', 'verify'])

const HELP = `${heading('Clara adapter management')}

Usage:
  clara adapter search [--json]
  clara adapter list [--json]
  clara adapter install <kind>[@version] [--pair <code>] [--transport local|relay|docker] [--ws-url <url>] [--from <path>] [--reuse-pairing] [--no-start]
  clara adapter upgrade [kind] [--no-start] [--json]
  clara adapter remove <kind> [--purge]
  clara adapter start|stop|status|logs <kind> [options]
  clara adapter verify <kind> [--directory <path>] [--write] [--json]
  clara pair adapter --harness <kind> [--transport local|relay|docker] [--ws-url <url>] [--install]

Kinds: ${ADAPTER_KINDS.join(', ')}

Adapter binaries are downloaded from the release registry only when you ask for
one. ${muted('Run `clara adapter search` to see published versions.')}
Pass ${muted('--from')} to install a package or dist directory built in a checkout.`

export async function runAdapters(args: readonly string[]): Promise<number> {
  const [sub = '', ...rest] = args
  if (sub === '' || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(HELP)
    return 0
  }
  if (sub === 'search') return runAdapterSearch(rest)
  if (sub === 'list') return runAdapterList(rest)
  if (sub === 'install') return runAdapterInstall(rest)
  if (sub === 'upgrade') return runAdapterUpgrade(rest)
  if (sub === 'remove') return runAdapterRemove(rest)
  if (CONTROL.has(sub as AdapterControlAction)) {
    return runAdapterControl(sub as AdapterControlAction, rest)
  }
  throw new Error(`unknown adapter command: ${sub} (try \`clara adapter --help\`)`)
}

/** `clara adapter search` lists the published release for every known kind. */
export async function runAdapterSearch(args: readonly string[]): Promise<number> {
  const parsed = parseAdapterArgs(args)
  if (parsed.values.length > 0) throw new Error(`usage: clara adapter search [--json]`)
  const json = parsed.flags.has('--json')
  const target = hostTarget()
  const spinner =
    json || !process.stdout.isTTY ? undefined : startSpinner('Reading the adapter registry')
  const report = await new AdapterRegistry().search(target)
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return report.entries.every((entry) => !entry.ok) ? 1 : 0
  }
  if (spinner) spinner.succeed(`Read ${report.entries.length} manifests from ${report.baseUrl}`)
  else console.log(muted(`Read ${report.entries.length} manifests from ${report.baseUrl}`))
  const rows = report.entries.map((entry) => ({
    kind: entry.kind,
    version: entry.ok ? (entry.version ?? '-') : '-',
    size: entry.size !== undefined ? formatBytes(entry.size) : '-',
    targets: entry.ok ? String(entry.platforms.length) : '-',
    note: entry.ok
      ? entry.target
        ? entry.target
        : `no build for ${hostLabel()}`
      : (entry.error ?? 'unavailable'),
  }))
  console.log(
    renderTable(rows, [
      { header: 'KIND', value: (row) => row.kind },
      { header: 'VERSION', value: (row) => row.version },
      { header: 'SIZE', value: (row) => row.size, align: 'right' },
      { header: 'TARGETS', value: (row) => row.targets, align: 'right' },
      { header: 'NOTES', value: (row) => row.note },
    ])
  )
  if (report.entries.every((entry) => !entry.ok)) {
    console.error(warn('The adapter registry could not be reached. Check the URL or your network.'))
    return 1
  }
  return 0
}

/** `clara adapter list` shows downloaded adapters and their reported state. */
export async function runAdapterList(args: readonly string[]): Promise<number> {
  const parsed = parseAdapterArgs(args)
  if (parsed.values.length > 0) throw new Error(`usage: clara adapter list [--json]`)
  const paths = resolvePaths()
  const entries = adapterListReport(paths)

  if (parsed.flags.has('--json')) {
    console.log(JSON.stringify({ schemaVersion: 1, adapters: entries }, null, 2))
    return 0
  }
  if (entries.length === 0) {
    console.log('No adapters are installed.')
    console.log(muted('Run `clara adapter search` to see published releases.'))
    return 0
  }

  console.log(
    renderTable(entries, [
      { header: 'KIND', value: (row) => row.kind },
      { header: 'VERSION', value: (row) => row.version },
      { header: 'PLATFORM', value: (row) => row.platform },
      { header: 'STATE', value: (row) => runtimeLabel(row.state) },
      { header: 'PAIRED', value: (row) => (row.pairedAt ? green('yes') : dim('no')) },
    ])
  )
  console.log(muted(`Installed under ${join(paths.dataDir, 'adapters')}`))
  for (const entry of entries) {
    if (entry.lastError) console.log(warn(`${entry.kind}: ${entry.lastError}`))
  }
  return 0
}

export type AdapterListEntry = AdapterInstallRecord & {
  state: AdapterRuntimeState
  live?: AdapterLiveState
}

/** Installed adapters plus their best-effort process state; reusable by `clara ps`. */
export function adapterListReport(
  paths: ReturnType<typeof resolvePaths> = resolvePaths()
): AdapterListEntry[] {
  const state = readAdapterState(paths)
  return ADAPTER_KINDS.flatMap((kind) => {
    const record = state.adapters[kind]
    if (!record) return []
    const live = readAdapterLiveState(kind, paths)
    return [
      {
        ...record,
        state: adapterRuntimeState(kind, { env: adapterEnv(paths, kind) }),
        ...(live ? { live } : {}),
      },
    ]
  })
}

function runtimeLabel(runtime: ReturnType<typeof adapterRuntimeState>): string {
  if (runtime === 'running') return stateLabel('running')
  if (runtime === 'stopped') return stateLabel('stopped')
  return dim('unknown')
}

function hostTarget(): AdapterTarget | undefined {
  try {
    return detectAdapterTarget()
  } catch (cause) {
    if (cause instanceof UnsupportedPlatformError) return undefined
    throw cause
  }
}

function hostLabel(): string {
  return `${process.platform}-${process.arch}`
}
