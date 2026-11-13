import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import {
  HARNESS_PAIRING_CODE_PREFIX,
  parseHarnessPairingInput,
  type HarnessPairingPayload,
} from '@clara/shared-types'
import {
  adapterLogSize,
  argValue,
  enrollAdapter,
  foregroundCommand,
  hasFlag,
  installAdapterService,
  removeAdapterService,
  removeState,
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
  type ClaudeConfig,
  type ClaudePermissionMode,
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
  claudePath?: string
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
  return {
    ...(argValue(args, '--pair') ? { pair: argValue(args, '--pair') } : {}),
    ...(argValue(args, '--claude-path') ? { claudePath: argValue(args, '--claude-path') } : {}),
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
  const pairing = await pairingInput(options.pair)
  if (pairing.kind !== 'claude') {
    throw new Error(`This pairing code is for ${pairing.kind}, not Claude Code`)
  }

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
  if (!options.dryRun) {
    writeConfig({
      ...identity,
      wsUrl: pairing.wsUrl,
      clientToken: pairing.clientToken,
      claude,
      label: 'Claude Code',
    })
    actions.push(`write adapter config ${adapterConfigPath()}`)
  }

  let enrolled: { connectionId: string; reconnected: boolean }
  try {
    enrolled = options.dryRun
      ? { connectionId: '(dry run)', reconnected: false }
      : await enrollAdapter({
          wsUrl: pairing.wsUrl,
          clientToken: pairing.clientToken,
          enrollId: pairing.enrollId,
          enrollToken: pairing.enrollToken,
          harnessId: identity.harnessId,
          kind: pairing.kind,
          label: 'Claude Code',
          adapterId: identity.adapterId,
          key: identity.key,
          adapterVersion: ADAPTER_VERSION,
          ...(probe.version ? { harnessVersion: probe.version } : {}),
          capabilities: CLAUDE_CAPABILITIES,
        })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    if (options.dryRun) throw new Error(reason, { cause })
    warnings.push(reason)
    actions.push(`pair adapter ${identity.harnessId} (enrollment response missing)`)
    if (options.noService) {
      actions.push(`run the adapter in the foreground: ${commands}`)
      return { actions, warnings, configPath: adapterConfigPath(), foregroundCommand: commands }
    }
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
    throw new Error(
      `${reason}\nThe adapter config was saved at ${adapterConfigPath()}. ` +
        `Start it with: clara-adapter-claude start\n` +
        `Log: ${adapterLogPath()}`,
      { cause }
    )
  }
  actions.push(`pair adapter ${identity.harnessId} as connection ${enrolled.connectionId}`)

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

  return {
    ...(resolvedPath ? { claudePath: resolvedPath } : {}),
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
        entry: process.argv[1] ?? '',
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

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}
