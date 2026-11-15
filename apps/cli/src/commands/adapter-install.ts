import { AdapterRegistry, ADAPTER_KINDS, type AdapterKind } from '../adapters/registry.ts'
import {
  installAdapter,
  removeAdapter,
  upgradeAdapter,
  type InstallDeps,
  type UpgradeReport,
} from '../adapters/install.ts'
import { issueAdapterPairing, type PairingTransport } from '../adapters/pairing.ts'
import { detectAdapterTarget } from '../adapters/platform.ts'
import { readAdapterState, type AdapterInstallRecord } from '../adapters/state.ts'
import { resolvePaths } from '../paths.ts'
import { detectRole } from '../state/role.ts'
import { adapterInstallGuard } from './role-guard.ts'
import { dim, green } from '../ui/color.ts'
import { formatBytes, muted, success, warn } from '../ui/index.ts'
import { startSpinner, type Spinner } from '../ui/spinner.ts'
import { renderTable } from '../ui/table.ts'
import { parseAdapterArgs, parseKindSpec, parseTransport, requireKind } from './adapter-args.ts'

/** `clara adapter install <kind>[@version] [--pair <code>] [--no-start]`. */
export async function runAdapterInstall(args: readonly string[]): Promise<number> {
  const parsed = parseAdapterArgs(args)
  const spec = requireKind(parsed.values[0], 'install')
  const json = parsed.flags.has('--json')
  const paths = resolvePaths()
  const pairCode = parsed.options.get('--pair')
  const guard = pairCode ? undefined : adapterInstallGuard(detectRole(paths), spec.kind)
  if (guard) {
    console.error(guard)
    return 1
  }
  const spinner =
    json || !process.stdout.isTTY ? undefined : startSpinner(`Installing the ${spec.kind} adapter`)
  const transport = parseTransport(parsed.options.get('--transport'))
  const wsUrl = parsed.options.get('--ws-url')
  try {
    const target = detectAdapterTarget()
    const version = spec.version ?? parsed.options.get('--version')
    const code = pairCode ?? (await issueCode(spec.kind, transport, spinner, wsUrl))
    const record = await installAdapter(
      {
        kind: spec.kind,
        ...(version ? { version } : {}),
        target,
        pairCode: code,
        start: !parsed.flags.has('--no-start'),
      },
      installDeps(paths, spinner, json)
    )
    if (json) {
      console.log(JSON.stringify(record, null, 2))
      return 0
    }
    if (spinner) spinner.succeed(`Installed ${record.kind} ${record.version} (${record.platform})`)
    else console.log(success(`Installed ${record.kind} ${record.version} (${record.platform})`))
    printRecord(record)
    if (record.lastError) {
      console.log(warn(record.lastError))
      return 1
    }
    return 0
  } catch (cause) {
    if (!json) spinner?.fail(`The ${spec.kind} adapter did not install.`)
    throw cause
  }
}

/** `clara adapter upgrade [kind]` moves installed adapters to the latest release. */
export async function runAdapterUpgrade(args: readonly string[]): Promise<number> {
  const parsed = parseAdapterArgs(args)
  const json = parsed.flags.has('--json')
  const paths = resolvePaths()
  const state = readAdapterState(paths)
  const requested = parsed.values.length
    ? parsed.values.map((value) => parseKindSpec(value).kind)
    : ADAPTER_KINDS.filter((kind) => state.adapters[kind])
  if (requested.length === 0) {
    if (json) console.log(JSON.stringify([], null, 2))
    else console.log('No adapters are installed. Run `clara adapter install <kind>` first.')
    return 0
  }

  const spinner =
    json || !process.stdout.isTTY ? undefined : startSpinner('Checking adapter releases')
  const deps = installDeps(paths, spinner, json)
  const reports: UpgradeReport[] = []
  for (const kind of requested) {
    spinner?.update(`Checking the ${kind} adapter release`)
    try {
      const report = await upgradeAdapter(kind, deps, {
        start: !parsed.flags.has('--no-start'),
      })
      reports.push(report)
      if (report.changed) spinner?.update(`${kind} ${report.from} -> ${report.to}`)
    } catch (cause) {
      reports.push({ kind, changed: false, error: errorText(cause) })
    }
  }
  spinner?.stop()

  if (json) {
    console.log(JSON.stringify(reports, null, 2))
  } else {
    console.log(
      renderTable(reports, [
        { header: 'KIND', value: (row) => row.kind },
        { header: 'FROM', value: (row) => row.from ?? '-' },
        { header: 'TO', value: (row) => row.to ?? '-' },
        {
          header: 'STATUS',
          value: (row) =>
            row.error ? warn(row.error) : row.changed ? green('upgraded') : dim('up to date'),
        },
      ])
    )
  }
  return reports.every((report) => !report.error) ? 0 : 1
}

/** `clara adapter remove <kind> [--purge]`. */
export async function runAdapterRemove(args: readonly string[]): Promise<number> {
  const parsed = parseAdapterArgs(args)
  const spec = requireKind(parsed.values[0], 'remove')
  const paths = resolvePaths()
  const purge = parsed.flags.has('--purge')
  console.log(muted(`Removing the ${spec.kind} adapter${purge ? ' and its credentials' : ''}...`))
  const actions = await removeAdapter(spec.kind, installDeps(paths, undefined, true), { purge })
  for (const action of actions) console.log(success(action))
  return 0
}

/** `clara pair adapter --harness <kind> [--transport local|relay] [--install]`. */
export async function runPairAdapter(args: readonly string[]): Promise<number> {
  const parsed = parseAdapterArgs(args)
  const kind = requireKind(
    parsed.options.get('--harness') ?? parsed.values[0],
    'pair adapter --harness',
    'clara'
  )
  const transport = parseTransport(parsed.options.get('--transport'))
  const json = parsed.flags.has('--json')
  const spinner =
    json || !process.stdout.isTTY ? undefined : startSpinner(`Issuing a ${kind.kind} pairing code`)
  const pairing = await issueAdapterPairing(kind.kind, transport, {
    ...(parsed.options.get('--ws-url') ? { wsUrl: parsed.options.get('--ws-url')! } : {}),
  })
  spinner?.succeed(`Pairing code ready (expires ${pairing.expiresAt})`)

  if (json) {
    if (!parsed.flags.has('--install')) console.log(JSON.stringify(pairing, null, 2))
  } else {
    console.log('')
    console.log(`  ${pairing.code}`)
    console.log('')
    console.log(`Install and pair on this machine:`)
    console.log(`  clara adapter install ${kind.kind} --pair ${pairing.code}`)
    console.log('')
    console.log('Or run the downloaded adapter directly on another machine:')
    console.log(`  clara-adapter-${kind.kind} install --pair ${pairing.code}`)
  }

  if (!parsed.flags.has('--install')) return 0
  const installSpinner =
    json || !process.stdout.isTTY ? undefined : startSpinner(`Installing the ${kind.kind} adapter`)
  const record = await installAdapter(
    {
      kind: kind.kind,
      pairCode: pairing.code,
      start: true,
      ...(kind.version ? { version: kind.version } : {}),
    },
    installDeps(resolvePaths(), installSpinner, json)
  )
  if (json) console.log(JSON.stringify(record, null, 2))
  else {
    if (installSpinner) installSpinner.succeed(`Installed ${record.kind} ${record.version}`)
    else console.log(success(`Installed ${record.kind} ${record.version}`))
    printRecord(record)
  }
  return 0
}

async function issueCode(
  kind: AdapterKind,
  transport: PairingTransport,
  spinner: Spinner | undefined,
  wsUrl?: string
): Promise<string> {
  spinner?.update(`Issuing a ${kind} pairing code`)
  const pairing = await issueAdapterPairing(kind, transport, {
    ...(wsUrl ? { wsUrl } : {}),
  })
  return pairing.code
}

function installDeps(
  paths: ReturnType<typeof resolvePaths>,
  spinner: Spinner | undefined,
  json: boolean
): InstallDeps {
  return {
    registry: new AdapterRegistry(),
    paths,
    ...(json
      ? {}
      : {
          onProgress: (received: number, total: number | undefined) =>
            spinner?.update(
              `Downloading the adapter ${formatBytes(received)}${total ? ` / ${formatBytes(total)}` : ''}`
            ),
          log: (message: string) => spinner?.update(message),
          onPhase: () => spinner?.stop(),
        }),
  }
}

function printRecord(record: AdapterInstallRecord): void {
  console.log(`  version:  ${record.version}`)
  console.log(`  platform: ${record.platform}`)
  console.log(`  path:     ${record.path}`)
  console.log(`  paired:   ${record.pairedAt ? 'yes' : 'no'}`)
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
