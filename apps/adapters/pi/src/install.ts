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
  resolveInstallPairing,
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
  const pairing = await resolveInstallPairing({
    name: 'pi',
    label: 'Pi',
    paths: piPaths(),
    ...(options.pair ? { pair: options.pair } : {}),
    ...(options.reusePairing ? { reuse: true } : {}),
  })

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
          kind: 'pi',
          label: 'Pi',
          adapterId: identity.adapterId,
          key: identity.key,
          adapterVersion: ADAPTER_VERSION,
          ...(probe.version ? { harnessVersion: probe.version } : {}),
          capabilities: PI_CAPABILITIES,
        })
        connection = result.connectionId
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
  }

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
