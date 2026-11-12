import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import {
  HARNESS_PAIRING_CODE_PREFIX,
  parseHarnessPairingInput,
  type HarnessPairingPayload,
} from '@clara/shared-types'
import {
  adapterConfigPath,
  adapterLogPath,
  loadIdentity,
  removeConfig,
  removeIdentity,
  writeConfig,
} from './config.ts'
import { discoverOpenCode } from './discover.ts'
import { enrollAdapter } from './enroll.ts'
import { OpenCodeClient } from './opencode.ts'
import { removeState } from './state.ts'
import {
  adapterEntry,
  adapterLogSize,
  foregroundCommand,
  installAdapterService,
  removeAdapterService,
  startAdapterProcess,
  waitForAdapterAuthentication,
} from './service.ts'

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
  dryRun?: boolean
  entry?: string
}

export type InstallResult = {
  actions: string[]
  warnings: string[]
  configPath: string
  foregroundCommand: string
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
  const probe = await new OpenCodeClient(openCode.url, openCode.password, openCode.username).probe(
    3_000
  )

  const entry = options.entry ?? adapterEntry()
  const command = foregroundCommand(entry)
  const actions = [`use OpenCode ${openCode.url}`]
  const warnings: string[] = []

  // Persist before enrollment. If the hub enrolls the adapter but the response
  // is lost, the saved credential can still reconnect on `adapter start`.
  if (!options.dryRun) {
    writeConfig({
      ...identity,
      wsUrl: pairing.wsUrl,
      clientToken: pairing.clientToken,
      opencode: openCode,
      label: 'OpenCode',
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
          label: 'OpenCode',
          adapterId: identity.adapterId,
          key: identity.key,
          adapterVersion: ADAPTER_VERSION,
          ...(probe.version ? { harnessVersion: probe.version } : {}),
          capabilities: CAPABILITIES,
        })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    if (options.dryRun) throw new Error(reason, { cause })
    warnings.push(reason)
    actions.push(`pair adapter ${identity.harnessId} (enrollment response missing)`)
    if (options.noService) {
      actions.push(`run the adapter in the foreground: ${command}`)
      return { actions, warnings, configPath: adapterConfigPath(), foregroundCommand: command }
    }
    const offset = adapterLogSize()
    const started = startAdapterProcess(entry)
    actions.push(...started.actions)
    if (await waitForAdapterAuthentication(offset)) {
      warnings.push(
        'The enrollment response was lost, but the adapter connected with the saved credential.'
      )
      return { actions, warnings, configPath: adapterConfigPath(), foregroundCommand: command }
    }
    throw new Error(
      `${reason}\nThe adapter config was saved at ${adapterConfigPath()}. ` +
        `Start it with: pnpm clara adapter start --opencode\n` +
        `Log: ${adapterLogPath()}`,
      { cause }
    )
  }
  actions.push(`pair adapter ${identity.harnessId} as connection ${enrolled.connectionId}`)

  if (options.noService) {
    actions.push(`run the adapter in the foreground: ${command}`)
  } else if (options.dryRun) {
    actions.push(`install user service or start background adapter for ${entry}`)
  } else {
    const service = installAdapterService(entry)
    actions.push(...service.actions)
    if (service.warning) warnings.push(service.warning)
    if (service.service === 'none' || service.warning) {
      const started = startAdapterProcess(entry)
      actions.push(...started.actions)
    }
  }
  return { actions, warnings, configPath: adapterConfigPath(), foregroundCommand: command }
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

async function promptOpenCode(): Promise<{
  url: string
  username: string
  password?: string
}> {
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
  const probe = await new OpenCodeClient(config.url, config.password, config.username).probe(3_000)
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

export function uninstallOpenCodeAdapter(options: { purge?: boolean } = {}): string[] {
  const actions = removeAdapterService()
  removeConfig()
  removeState()
  actions.push(`remove adapter config ${adapterConfigPath()}`)
  if (options.purge) {
    removeIdentity()
    actions.push('remove harness identity and credential')
  }
  return actions
}
