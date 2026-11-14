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
  enrollAdapter,
  foregroundCommand,
  hasFlag,
  installAdapterService,
  isLocalHubUrl,
  removeAdapterService,
  removeState,
  selfEntry,
  startAdapterProcess,
  waitForAdapterAuthentication,
} from '@clara/adapter-runtime'
import {
  adapterConfigPath,
  adapterLogPath,
  loadIdentity,
  piPaths,
  removeConfig,
  removeIdentity,
  writeConfig,
  type AdapterConfig,
} from './config.ts'
import { PI_CAPABILITIES } from './capabilities.ts'
import {
  detectPiInstallation,
  parseInstallOptions,
  piProcessEnv,
  probePi,
  resolvePiConfigFromOptions,
  type PiInstallOptions,
} from './discover.ts'
import { probePiRpc } from './pi/client.ts'
import { piAdapterDaemonEntry } from './package-paths.ts'

const ADAPTER_VERSION = '0.1.0'

export type InstallResult = {
  actions: string[]
  warnings: string[]
  configPath: string
  foregroundCommand: string
}

export async function installPiCommand(args: string[]): Promise<InstallResult> {
  const result = await installPi(parseInstallOptions(args))
  for (const action of result.actions) console.log(action)
  for (const warning of result.warnings) console.error(`warn ${warning}`)
  return result
}

/** Pair the adapter and install its user service. */
export async function installPi(options: PiInstallOptions): Promise<InstallResult> {
  const pairing = await pairingInput(options.pair)
  if (pairing.kind !== 'pi') {
    throw new Error(`This pairing code is for ${pairing.kind}, not Pi`)
  }

  const pi = resolvePiConfigFromOptions(options)
  const installation = detectPiInstallation(pi.piPath)
  if (!installation) {
    throw new Error('Pi was not found after resolving the adapter config')
  }
  const probe = await probePi(pi, 5_000)
  if (!probe.ok) {
    throw new Error(
      `Pi is not ready: ${probe.message ?? probe.code}. ` +
        'Install Pi from https://pi.dev, then retry.'
    )
  }
  await probePiRpc(installation.binary, process.cwd(), piProcessEnv(pi), {
    trust: pi.trust,
    ...(pi.model ? { model: pi.model } : {}),
    ...(pi.thinkingLevel ? { thinkingLevel: pi.thinkingLevel } : {}),
  }).catch((cause: unknown) => {
    throw new Error(
      `Pi did not answer in RPC mode: ${cause instanceof Error ? cause.message : String(cause)}`
    )
  })

  const entry = piAdapterDaemonEntry()
  const commands = foregroundCommand(entry)
  const actions = [
    probe.version
      ? `use Pi ${probe.version} at ${installation.binary}`
      : `use Pi at ${installation.binary}`,
    'RPC handshake ready',
  ]
  const warnings: string[] = []

  const identity = loadIdentity()
  // Save the config before enrollment so a lost enrollment response can still
  // reconnect with the stored credential.
  const config: AdapterConfig = {
    ...identity,
    wsUrl: pairing.wsUrl,
    grant: pairing.grant ?? '',
    pi,
    label: 'Pi',
  }
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
        label: 'Pi',
        adapterId: identity.adapterId,
        key: identity.key,
        adapterVersion: ADAPTER_VERSION,
        ...(probe.version ? { harnessVersion: probe.version } : {}),
        capabilities: PI_CAPABILITIES,
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
    const paths = piPaths()
    const offset = adapterLogSize(paths)
    const started = startAdapterProcess({ name: 'pi', label: 'Pi', entry, paths })
    actions.push(...started.actions)
    if (await waitForAdapterAuthentication(paths, offset)) {
      warnings.push(
        'The enrollment response was lost, but the adapter connected with the saved credential.'
      )
      return { actions, warnings, configPath: adapterConfigPath(), foregroundCommand: commands }
    }
    throw new Error(
      `${reason}\nThe adapter config was saved at ${adapterConfigPath()}. ` +
        `Start it with: clara-adapter-pi start\n` +
        `Log: ${adapterLogPath()}`,
      { cause }
    )
  }

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
    const paths = piPaths()
    const service = installAdapterService({ name: 'pi', label: 'Pi', entry, paths })
    actions.push(...service.actions)
    if (service.warning) warnings.push(service.warning)
    if (service.service === 'none' || service.warning) {
      const started = startAdapterProcess({ name: 'pi', label: 'Pi', entry, paths })
      actions.push(...started.actions)
    }
  }
  return { actions, warnings, configPath: adapterConfigPath(), foregroundCommand: commands }
}

export function uninstallPiCommand(args: string[]): void {
  const dryRun = hasFlag(args, '--dry-run')
  const purge = hasFlag(args, '--purge')
  const paths = piPaths()
  const actions: string[] = []
  if (!dryRun) {
    actions.push(
      ...removeAdapterService({
        name: 'pi',
        label: 'Pi',
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
