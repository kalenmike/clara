import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import {
  HARNESS_PAIRING_CODE_PREFIX,
  parseHarnessPairingInput,
  type HarnessPairingPayload,
} from '@clara/shared-types'
import {
  REINSTALL_GRANT_MESSAGE,
  adapterLogSize,
  argValue,
  enrollAdapter,
  foregroundCommand,
  hasFlag,
  installAdapterService,
  isLocalHubUrl,
  removeAdapterService,
  removeState,
  startAdapterProcess,
  waitForAdapterAuthentication,
} from '@clara/adapter-runtime'
import { installRunner } from '@clara/runner'
import {
  adapterConfigPath,
  adapterLogPath,
  loadIdentity,
  openCodePaths,
  removeConfig,
  removeIdentity,
  writeConfig,
  type AdapterConfig,
  type OpenCodeConfig,
} from './config.ts'
import { installOpenCode as installOpenCodeBinding, uninstallOpenCode } from './binding.ts'
import { discoverOpenCode } from './discover.ts'
import { OpenCodeGateway } from './opencode.ts'
import { mcpEntryPath, openCodeAdapterDaemonEntry } from './package-paths.ts'

const ADAPTER_VERSION = '0.1.0'

const CAPABILITIES = {
  projects: { list: true, update: true },
  sessions: { list: true, create: true, update: true, delete: true, fork: true },
  messages: true,
  forms: true,
  inbox: true,
  permissions: true,
  catalog: {
    agents: true,
    models: true,
    providers: true,
    commands: true,
    skills: true,
    references: true,
  },
  files: true,
  vcs: true,
  worktrees: true,
  git: true,
  events: true,
}

export type InstallOptions = {
  pair?: string
  opencodeUrl?: string
  opencodeUsername?: string
  opencodePassword?: string
  noService?: boolean
  noRunner?: boolean
  noBinding?: boolean
  mcp?: boolean
  dryRun?: boolean
  force?: boolean
  entry?: string
  workspace?: string
  url?: string
  concurrency?: number
  labels?: string[]
}

export type InstallResult = {
  actions: string[]
  warnings: string[]
  configPath: string
  foregroundCommand: string
}

export async function installOpenCodeCommand(args: string[]): Promise<InstallResult> {
  const result = await installOpenCode(parseInstallOptions(args))
  for (const action of result.actions) console.log(action)
  for (const warning of result.warnings) console.error(`warn ${warning}`)
  return result
}

export function parseInstallOptions(args: string[]): InstallOptions {
  const concurrency = argValue(args, '--concurrency')
  return {
    ...(argValue(args, '--pair') ? { pair: argValue(args, '--pair') } : {}),
    ...(argValue(args, '--opencode-url') ? { opencodeUrl: argValue(args, '--opencode-url') } : {}),
    ...(argValue(args, '--opencode-username')
      ? { opencodeUsername: argValue(args, '--opencode-username') }
      : {}),
    ...(argValue(args, '--opencode-password')
      ? { opencodePassword: argValue(args, '--opencode-password') }
      : {}),
    noService: hasFlag(args, '--no-service'),
    noRunner: hasFlag(args, '--no-runner'),
    noBinding: hasFlag(args, '--no-binding'),
    mcp: hasFlag(args, '--mcp'),
    dryRun: hasFlag(args, '--dry-run'),
    force: hasFlag(args, '--force'),
    ...(argValue(args, '--workspace') ? { workspace: argValue(args, '--workspace') } : {}),
    ...(argValue(args, '--url') ? { url: argValue(args, '--url') } : {}),
    ...(concurrency ? { concurrency: Number(concurrency) } : {}),
    labels: args.flatMap((arg, index) =>
      arg === '--label' && args[index + 1] ? [args[index + 1]!] : []
    ),
  }
}

/** Install the hub-facing daemon, the OpenCode binding, and the shared runner. */
export async function installOpenCode(options: InstallOptions): Promise<InstallResult> {
  const actions: string[] = []
  const warnings: string[] = []
  const url = (
    options.url ??
    process.env.CLARA_ORCHESTRATION_URL?.trim() ??
    'http://127.0.0.1:8789'
  ).replace(/\/$/, '')

  const daemon = await installOpenCodeAdapter(options)
  actions.push(...daemon.actions)
  warnings.push(...daemon.warnings)

  if (!options.noBinding) {
    const mcpEntry =
      options.mcp && !options.dryRun
        ? { command: [process.execPath, mcpEntryPath()], url }
        : undefined
    const binding = installOpenCodeBinding({
      force: options.force ?? false,
      mcp: options.mcp ?? false,
      url,
      ...(mcpEntry ? { mcpEntry } : {}),
      dryRun: options.dryRun,
    })
    actions.push(...binding.actions)
  } else {
    actions.push('skip the OpenCode binding (--no-binding)')
  }

  if (!options.noRunner) {
    const runner = installRunner({
      ...(options.workspace ? { workspace: options.workspace } : {}),
      url,
      ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
      labels: options.labels ?? [],
      noService: options.noService,
      dryRun: options.dryRun,
    })
    actions.push(...runner.actions)
    warnings.push(...runner.warnings)
  }

  return {
    actions,
    warnings,
    configPath: adapterConfigPath(),
    foregroundCommand: daemon.foregroundCommand,
  }
}

/** Install the hub-facing adapter daemon and pair it in one command. */
export async function installOpenCodeAdapter(options: InstallOptions): Promise<InstallResult> {
  const pairing = await pairingInput(options.pair)
  if (pairing.kind !== 'opencode') {
    throw new Error(`This pairing code is for ${pairing.kind}, not OpenCode`)
  }
  const discovery = await discoverOpenCode({
    ...(options.opencodeUrl ? { url: options.opencodeUrl } : {}),
    ...(options.opencodeUsername ? { username: options.opencodeUsername } : {}),
    ...(options.opencodePassword ? { password: options.opencodePassword } : {}),
  })
  const openCode = discovery ?? (await promptOpenCode())
  const identity = loadIdentity()
  const probe = await new OpenCodeGateway({
    url: openCode.url,
    username: openCode.username,
    ...(openCode.password ? { password: openCode.password } : {}),
  }).probe(3_000)

  const entry = options.entry ?? openCodeAdapterDaemonEntry()
  const commands = foregroundCommand(entry)
  const actions = [`use OpenCode ${openCode.url}`]
  const warnings: string[] = []

  const config: AdapterConfig = {
    ...identity,
    wsUrl: pairing.wsUrl,
    // The enrollment grant is the only grant known before enrollment. It is
    // replaced by the adapter grant from `adapter.enrolled` below.
    grant: pairing.grant ?? '',
    opencode: openCode,
    label: 'OpenCode',
  }

  // Persist before enrollment. If the hub enrolls the adapter but the response
  // is lost, the saved credential can still reconnect on `adapter start`.
  if (!options.dryRun) {
    writeConfig(config)
    actions.push(`write adapter config ${adapterConfigPath()}`)
  }

  let enrolled: { connectionId: string; reconnected: boolean }
  let deviceGrant: string | undefined
  try {
    if (options.dryRun) {
      enrolled = { connectionId: '(dry run)', reconnected: false }
    } else {
      const result = await enrollAdapter({
        wsUrl: pairing.wsUrl,
        ...(pairing.grant ? { grant: pairing.grant } : {}),
        enrollId: pairing.enrollId,
        enrollToken: pairing.enrollToken,
        harnessId: identity.harnessId,
        kind: pairing.kind,
        label: 'OpenCode',
        adapterId: identity.adapterId,
        key: identity.key,
        adapterVersion: ADAPTER_VERSION,
        ...(probe.version ? { harnessVersion: probe.version } : {}),
        capabilities: CAPABILITIES,
      })
      enrolled = result
      deviceGrant = result.relayGrant?.grant
    }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    if (options.dryRun) throw new Error(reason, { cause })
    warnings.push(reason)
    actions.push(`pair adapter ${identity.harnessId} (enrollment response missing)`)
    if (options.noService) {
      actions.push(`run the adapter in the foreground: ${commands}`)
      return { actions, warnings, configPath: adapterConfigPath(), foregroundCommand: commands }
    }
    const paths = openCodePaths()
    const offset = adapterLogSize(paths)
    const started = startAdapterProcess({
      name: 'opencode',
      label: 'OpenCode',
      entry,
      paths,
    })
    actions.push(...started.actions)
    if (await waitForAdapterAuthentication(paths, offset)) {
      warnings.push(
        'The enrollment response was lost, but the adapter connected with the saved credential.'
      )
      return { actions, warnings, configPath: adapterConfigPath(), foregroundCommand: commands }
    }
    throw new Error(
      `${reason}\nThe adapter config was saved at ${adapterConfigPath()}. ` +
        `Start it with: clara-adapter-opencode start\n` +
        `Log: ${adapterLogPath()}`,
      { cause }
    )
  }
  // The one-time enrollment grant cannot authenticate an adapter session.
  // Persist the adapter grant before the service starts and reconnects.
  if (!options.dryRun) {
    if (deviceGrant) {
      writeConfig({ ...config, grant: deviceGrant })
      actions.push('store the adapter relay grant')
    } else if (!isLocalHubUrl(pairing.wsUrl)) {
      throw new Error(REINSTALL_GRANT_MESSAGE)
    }
  }
  actions.push(`pair adapter ${identity.harnessId} as connection ${enrolled.connectionId}`)

  if (options.noService) {
    actions.push(`run the adapter in the foreground: ${commands}`)
  } else if (options.dryRun) {
    actions.push(`install user service or start background adapter for ${entry}`)
  } else {
    const paths = openCodePaths()
    const service = installAdapterService({
      name: 'opencode',
      label: 'OpenCode',
      entry,
      paths,
    })
    actions.push(...service.actions)
    if (service.warning) warnings.push(service.warning)
    if (service.service === 'none' || service.warning) {
      const started = startAdapterProcess({
        name: 'opencode',
        label: 'OpenCode',
        entry,
        paths,
      })
      actions.push(...started.actions)
    }
  }
  return { actions, warnings, configPath: adapterConfigPath(), foregroundCommand: commands }
}

async function pairingInput(value: string | undefined): Promise<HarnessPairingPayload> {
  if (!value && !stdin.isTTY) {
    throw new Error('Pass --pair <code> in a non-interactive install')
  }
  const code = value ?? (await prompt('Pairing code: '))
  const parsed = parseHarnessPairingInput(code)
  if (!parsed) throw new Error('That is not a valid Clara harness pairing code')
  if (parsed.expiresAt <= Date.now()) {
    throw new Error(
      `That pairing code expired. Generate a new one in the hub panel (codes start with ${HARNESS_PAIRING_CODE_PREFIX}).`
    )
  }
  return parsed
}

export async function resolveOpenCodeConfig(args: string[]): Promise<OpenCodeConfig> {
  const discovery = await discoverOpenCode({
    ...(argValue(args, '--opencode-url') ? { url: argValue(args, '--opencode-url') } : {}),
    ...(argValue(args, '--opencode-username')
      ? { username: argValue(args, '--opencode-username') }
      : {}),
    ...(argValue(args, '--opencode-password')
      ? { password: argValue(args, '--opencode-password') }
      : {}),
  })
  return discovery ?? (await promptOpenCode())
}

async function promptOpenCode(): Promise<OpenCodeConfig> {
  if (!stdin.isTTY) {
    throw new Error(
      'Could not discover OpenCode. Pass --opencode-url and --opencode-password, or run interactively.'
    )
  }
  console.log('Could not discover a reachable OpenCode server.')
  const url = (await prompt('OpenCode URL [http://127.0.0.1:4096]: ')) || 'http://127.0.0.1:4096'
  const username = (await prompt('OpenCode username [opencode]: ')) || 'opencode'
  const password = await prompt('OpenCode password (leave blank for none): ')
  const config = {
    url: url.replace(/\/+$/, ''),
    username,
    ...(password ? { password } : {}),
  }
  const probe = await new OpenCodeGateway({
    url: config.url,
    username: config.username,
    ...(config.password ? { password: config.password } : {}),
  }).probe(3_000)
  if (!probe.ok) {
    throw new Error(`OpenCode is still unreachable (${probe.code}): ${probe.message ?? ''}`)
  }
  return config
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

export function uninstallOpenCodeCommand(args: string[]): void {
  const dryRun = hasFlag(args, '--dry-run')
  const purge = hasFlag(args, '--purge')
  const force = hasFlag(args, '--force')
  const actions = [...uninstallOpenCode({ force, dryRun }), ...uninstallDaemon({ purge, dryRun })]
  for (const action of actions) console.log(action)
}

function uninstallDaemon(input: { purge: boolean; dryRun: boolean }): string[] {
  const paths = openCodePaths()
  const actions: string[] = []
  if (!input.dryRun) {
    actions.push(
      ...removeAdapterService({
        name: 'opencode',
        label: 'OpenCode',
        entry: process.argv[1] ?? '',
        paths,
      })
    )
    removeConfig()
    removeState(paths.statePath)
    actions.push(`remove adapter config ${adapterConfigPath()}`)
    if (input.purge) {
      removeIdentity()
      actions.push('remove harness identity and credential')
    }
  } else {
    actions.push(`remove adapter config ${adapterConfigPath()}`)
    if (input.purge) actions.push('remove harness identity and credential')
  }
  return actions
}
