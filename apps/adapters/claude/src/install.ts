import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import {
  REINSTALL_GRANT_MESSAGE,
  adapterLogSize,
  argValue,
  describeError,
  enrollAdapter,
  enrollmentFailure,
  foregroundCommand,
  hasFlag,
  installAdapterService,
  isLocalHubUrl,
  removeAdapterService,
  removeState,
  resolveInstallPairing,
  selfEntry,
  startAdapterProcess,
  waitForAdapterAuthentication,
} from '@clara/adapter-runtime'
import {
  adapterConfigPath,
  adapterLogPath,
  claudePaths,
  loadIdentity,
  removeConfig,
  removeIdentity,
  writeConfig,
  type AdapterConfig,
  type ClaudeConfig,
  type ClaudePermissionMode,
  type ClaudeProviderConfig,
} from './config.ts'
import { CLAUDE_CAPABILITIES } from './capabilities.ts'
import { detectClaudeInstallation, readClaudeAuth, readClaudeVersion } from './discover.ts'
import { AgentSdkGateway } from './sdk.ts'
import { claudeAdapterDaemonEntry } from './package-paths.ts'

const ADAPTER_VERSION = '0.1.0'
const PERMISSION_MODES: ClaudePermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
  'auto',
]

export type InstallOptions = {
  pair?: string
  /** Reuse the saved connection and skip enrollment. */
  reusePairing?: boolean
  claudePath?: string
  baseUrl?: string
  provider?: ClaudeProviderConfig
  model?: string
  agent?: string
  permissionMode?: ClaudePermissionMode
  noService?: boolean
  skipAuthCheck?: boolean
  dryRun?: boolean
  force?: boolean
  maxTurns?: number
  maxBudgetUsd?: number
  concurrency?: number
  additionalDirectories?: string[]
}

export type InstallResult = {
  actions: string[]
  warnings: string[]
  configPath: string
  foregroundCommand: string
}

export async function installClaudeCommand(args: string[]): Promise<InstallResult> {
  const result = await installClaude(parseInstallOptions(args))
  for (const action of result.actions) console.log(action)
  for (const warning of result.warnings) console.error(`warn ${warning}`)
  return result
}

export function parseInstallOptions(args: string[]): InstallOptions {
  const permissionMode = argValue(args, '--permission-mode')
  if (permissionMode && !PERMISSION_MODES.includes(permissionMode as ClaudePermissionMode)) {
    throw new Error(
      `--permission-mode must be one of ${PERMISSION_MODES.join(', ')} (received ${permissionMode})`
    )
  }
  const maxTurns = argValue(args, '--max-turns')
  const maxBudgetUsd = argValue(args, '--max-budget')
  const concurrency = argValue(args, '--concurrency')
  const providerId = argValue(args, '--provider-id')?.trim()
  const providerName = argValue(args, '--provider-name')?.trim()
  if (providerName && !providerId) {
    throw new Error('--provider-name requires --provider-id')
  }
  return {
    ...(argValue(args, '--pair') ? { pair: argValue(args, '--pair') } : {}),
    ...(hasFlag(args, '--reuse-pairing') ? { reusePairing: true } : {}),
    ...(argValue(args, '--claude-path') ? { claudePath: argValue(args, '--claude-path') } : {}),
    ...(argValue(args, '--base-url') ? { baseUrl: argValue(args, '--base-url') } : {}),
    ...(providerId
      ? {
          provider: {
            id: providerId,
            ...(providerName ? { name: providerName } : {}),
          },
        }
      : {}),
    ...(argValue(args, '--model') ? { model: argValue(args, '--model') } : {}),
    ...(argValue(args, '--agent') ? { agent: argValue(args, '--agent') } : {}),
    ...(permissionMode ? { permissionMode: permissionMode as ClaudePermissionMode } : {}),
    noService: hasFlag(args, '--no-service'),
    skipAuthCheck: hasFlag(args, '--skip-auth-check'),
    dryRun: hasFlag(args, '--dry-run'),
    force: hasFlag(args, '--force'),
    ...(maxTurns ? { maxTurns: Number(maxTurns) } : {}),
    ...(maxBudgetUsd ? { maxBudgetUsd: Number(maxBudgetUsd) } : {}),
    ...(concurrency ? { concurrency: Number(concurrency) } : {}),
    additionalDirectories: args.flatMap((arg, index) =>
      arg === '--additional-directory' && args[index + 1] ? [args[index + 1]!] : []
    ),
  }
}

/** Pair the adapter and install its user service. */
export async function installClaude(options: InstallOptions): Promise<InstallResult> {
  const pairing = await resolveInstallPairing({
    name: 'claude',
    label: 'Claude Code',
    paths: claudePaths(),
    ...(options.pair ? { pair: options.pair } : {}),
    ...(options.reusePairing ? { reuse: true } : {}),
  })

  const claude = await resolveClaudeConfigFromOptions(options)
  const identity = loadIdentity()
  const probe = await new AgentSdkGateway(claude).probe(3_000)
  if (!probe.ok && probe.code !== 'auth') {
    throw new Error(
      `Claude Code is not ready: ${probe.message ?? probe.code}. ` +
        'Install Claude Code on this machine, sign in with `claude auth login`, then retry.'
    )
  }

  const entry = claudeAdapterDaemonEntry()
  const commands = foregroundCommand(entry)
  const actions = [probe.version ? `use Claude Code ${probe.version}` : 'use Claude Code']
  const warnings: string[] = []
  if (!probe.ok && !options.skipAuthCheck) {
    warnings.push(probe.message ?? 'Claude Code is not signed in')
  }

  if (!options.skipAuthCheck) {
    const auth = await readClaudeAuth(detectClaudeInstallation(claude.claudePath)?.binary ?? '')
    if (auth && !auth.loggedIn) {
      warnings.push(
        'Claude Code is not signed in on this machine. Run `claude auth login` (or set ANTHROPIC_API_KEY) before starting a session.'
      )
    } else if (auth?.authMethod) {
      actions.push(`authentication: ${auth.authMethod}`)
    }
  }

  // Save the config before enrollment so a lost enrollment response can still
  // reconnect with the stored credential.
  const config: AdapterConfig = {
    ...identity,
    wsUrl: pairing.wsUrl,
    // A fresh install starts with the enrollment grant and is replaced by the
    // adapter grant below. A reinstall keeps the long-lived stored grant.
    grant: pairing.grant ?? '',
    claude,
    label: 'Claude Code',
  }
  if (!options.dryRun) {
    writeConfig(config)
    actions.push(`write adapter config ${adapterConfigPath()}`)
  }

  const enroll = pairing.enroll
  let connection: string | undefined
  let deviceGrant: string | undefined
  if (enroll) {
    try {
      if (options.dryRun) {
        connection = '(dry run)'
      } else {
        const result = await enrollAdapter({
          wsUrl: pairing.wsUrl,
          ...(pairing.grant ? { grant: pairing.grant } : {}),
          enrollId: enroll.enrollId,
          enrollToken: enroll.enrollToken,
          harnessId: identity.harnessId,
          kind: 'claude',
          label: 'Claude Code',
          adapterId: identity.adapterId,
          key: identity.key,
          adapterVersion: ADAPTER_VERSION,
          ...(probe.version ? { harnessVersion: probe.version } : {}),
          capabilities: CLAUDE_CAPABILITIES,
        })
        connection = result.connectionId
        deviceGrant = result.relayGrant?.grant
      }
    } catch (cause) {
      if (options.dryRun) throw new Error(describeError(cause), { cause })
      warnings.push(describeError(cause))
      actions.push(`pair adapter ${identity.harnessId} (enrollment response missing)`)
      const failure = enrollmentFailure({
        name: 'claude',
        label: 'Claude Code',
        entry,
        wsUrl: pairing.wsUrl,
        configPath: adapterConfigPath(),
        logPath: adapterLogPath(),
        cause,
      })
      if (options.noService) throw failure
      const paths = claudePaths()
      const offset = adapterLogSize(paths)
      const started = startAdapterProcess({
        name: 'claude',
        label: 'Claude Code',
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
      throw failure
    }
  }
  // The one-time enrollment grant cannot authenticate an adapter session.
  // Persist the adapter grant before the service starts and reconnects.
  if (!options.dryRun && enroll) {
    if (deviceGrant) {
      writeConfig({ ...config, grant: deviceGrant })
      actions.push('store the adapter relay grant')
    } else if (!isLocalHubUrl(pairing.wsUrl)) {
      throw new Error(REINSTALL_GRANT_MESSAGE)
    }
  }
  if (pairing.reused) {
    actions.push(`reuse the existing pairing for ${identity.harnessId}`)
  } else if (connection) {
    actions.push(`pair adapter ${identity.harnessId} as connection ${connection}`)
  }

  if (options.noService) {
    actions.push(`run the adapter in the foreground: ${commands}`)
  } else if (options.dryRun) {
    actions.push(`install user service or start background adapter for ${entry}`)
  } else {
    const paths = claudePaths()
    const service = installAdapterService({
      name: 'claude',
      label: 'Claude Code',
      entry,
      paths,
    })
    actions.push(...service.actions)
    if (service.warning) warnings.push(service.warning)
    if (service.service === 'none' || service.warning) {
      const started = startAdapterProcess({
        name: 'claude',
        label: 'Claude Code',
        entry,
        paths,
      })
      actions.push(...started.actions)
    }
  }
  return { actions, warnings, configPath: adapterConfigPath(), foregroundCommand: commands }
}

export async function resolveClaudeConfig(args: string[]): Promise<ClaudeConfig> {
  return resolveClaudeConfigFromOptions(parseInstallOptions(args))
}

async function resolveClaudeConfigFromOptions(options: InstallOptions): Promise<ClaudeConfig> {
  const configuredPath = options.claudePath ?? process.env.CLAUDE_CODE_PATH?.trim()
  const installation = detectClaudeInstallation(configuredPath)
  let resolvedPath = configuredPath
  let version = installation ? await readClaudeVersion(installation.binary, 3_000) : undefined

  if (!version && stdin.isTTY) {
    const answer = await prompt('Claude Code binary path (leave blank to use the bundled SDK): ')
    if (answer) {
      resolvedPath = answer
      version = await readClaudeVersion(answer, 3_000)
      if (!version) throw new Error(`Claude Code at ${answer} did not answer`)
    }
  }

  if (!installation && !version && !resolvedPath) {
    throw new Error(
      'Claude Code was not found. Install it on this machine, or pass --claude-path <path>.'
    )
  }

  // A compiled adapter cannot resolve the SDK's optional native package, so
  // persist the system binary it found on PATH for the service that starts it.
  const systemPath =
    resolvedPath ?? (installation?.source === 'path' ? installation.binary : undefined)

  return {
    ...(systemPath ? { claudePath: systemPath } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
    ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    permissionPrompts: 'host',
    ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}),
    ...(options.maxBudgetUsd ? { maxBudgetUsd: options.maxBudgetUsd } : {}),
    ...(options.concurrency ? { concurrency: options.concurrency } : {}),
    ...(options.additionalDirectories && options.additionalDirectories.length > 0
      ? { additionalDirectories: options.additionalDirectories }
      : {}),
  }
}

export function uninstallClaudeCommand(args: string[]): void {
  const dryRun = hasFlag(args, '--dry-run')
  const purge = hasFlag(args, '--purge')
  const paths = claudePaths()
  const actions: string[] = []
  if (!dryRun) {
    actions.push(
      ...removeAdapterService({
        name: 'claude',
        label: 'Claude Code',
        entry: selfEntry(),
        paths,
      })
    )
    removeConfig()
    removeState(paths.statePath)
    actions.push(`remove adapter config ${adapterConfigPath()}`)
    if (purge) {
      removeIdentity()
      actions.push('remove harness identity and credential')
    }
  } else {
    actions.push(`remove adapter config ${adapterConfigPath()}`)
    if (purge) actions.push('remove harness identity and credential')
  }
  for (const action of actions) console.log(action)
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}
