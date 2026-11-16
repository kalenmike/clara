import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import type { Hono } from 'hono'
import { HARNESS_PROTOCOL_VERSION } from '@clara/harness-protocol'
import {
  parseHarnessPairingInput,
  type AgentInfo,
  type HarnessPairingPayload,
  type RelayGrantState,
} from '@clara/shared-types'
import {
  REINSTALL_GRANT_MESSAGE,
  isLocalHubUrl,
  loadIdentity,
  readAdapterConfig,
  removeAdapterConfig,
  removeIdentity,
  writeAdapterConfig,
} from './config.ts'
import { EngineOrchestrator } from './engine.ts'
import { enrollAdapter } from './enroll.ts'
import { describeError } from './errors.ts'
import { createHostMetrics } from './host.ts'
import { readHostIdentity } from './host-identity.ts'
import {
  adapterInstallCommand,
  adapterProcessStatus,
  adapterServiceActive,
  adapterServiceKind,
  adapterStartCommand,
  clearAdapterPid,
  installAdapterService,
  removeAdapterService,
  selfEntry,
  startAdapterProcess,
  startAdapterService,
  stopAdapter,
  tailAdapterLog,
  writeAdapterPid,
} from './service.ts'
import { readState, writeState } from './state.ts'
import { recordInstallProvenance } from './provenance.ts'
import { runClaraCommand } from './clara-command.ts'
import {
  ensureAdapterRecord,
  forgetAdapterInstall,
  recordAdapterInstall,
} from './install-record.ts'
import {
  applyAdapterUpdate,
  checkAdapterUpdate,
  readAdapterUpdateStatus,
  registerAdapterUpdateRoutes,
  stageAdapterUpdate,
} from './update.ts'
import { AdapterTransport } from './transport.ts'
import type {
  AdapterConfig,
  AdapterInfo,
  AdapterLiveState,
  AdapterPaths,
  AdapterProbe,
  ServiceResult,
} from './types.ts'

export type AdapterDefinition<THarness> = {
  name: string
  version: string
  label: string
  capabilities: Record<string, unknown>
  paths: AdapterPaths
  /** Probe the harness for liveness and version. */
  probe(config: AdapterConfig<THarness>, timeoutMs?: number): Promise<AdapterProbe>
  /** Build the harness-specific HTTP surface served over the hub link. */
  createApp(input: {
    config: AdapterConfig<THarness>
    probe: AdapterProbe
    info: AdapterInfo
  }): Hono | Promise<Hono>
  /** The harness URL shown by `status`. */
  describe(config: AdapterConfig<THarness>): { url: string; label?: string }
  /** Discover or prompt for the harness-specific config during pairing. */
  resolveHarness(args: string[]): Promise<THarness>
  /** Full `install` command. Defaults to pairing when omitted. */
  install?(args: string[], helpers: AdapterInstallHelpers<THarness>): Promise<void>
  /** `uninstall` command. */
  uninstall?(args: string[]): Promise<void>
  /** Extra lines printed by `status` before the fallback probe. */
  statusLines?(config: AdapterConfig<THarness>, probe: AdapterProbe): string[]
  /**
   * `verify` command. Reports whether the adapter can read the native harness
   * store, and optionally proves a Clara-created session is native.
   */
  verify?(
    config: AdapterConfig<THarness>,
    options: AdapterVerifyOptions
  ): Promise<AdapterVerifyReport>
  help?: string
}

export type AdapterVerifyStatus = 'ok' | 'skip' | 'fail'

export type AdapterVerifyCheck = {
  name: string
  status: AdapterVerifyStatus
  detail?: string
  data?: Record<string, unknown>
}

export type AdapterVerifyReport = {
  adapter: string
  label: string
  harness?: string
  checks: AdapterVerifyCheck[]
}

export type AdapterVerifyOptions = {
  /** Directory whose native sessions are inspected. Defaults to the cwd. */
  directory?: string
  /** Create and remove a scratch session in the native store. */
  write: boolean
}

export type AdapterInstallHelpers<THarness> = {
  paths: AdapterPaths
  entry: string
  pair(args: string[]): Promise<AdapterConfig<THarness>>
  config(): AdapterConfig<THarness> | undefined
  writeConfig(config: AdapterConfig<THarness>): void
  installService(): ServiceResult
}

export async function runAdapterCli<THarness>(
  definition: AdapterDefinition<THarness>,
  argv: string[]
): Promise<void> {
  const [command = 'serve', ...args] = argv
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(definition.help ?? defaultHelp(definition))
    return
  }
  if (command === 'serve') {
    await serve(definition, args)
    return
  }
  if (command === 'pair') {
    await pair(definition, args)
    return
  }
  if (command === 'install') {
    if (hasFlag(args, '--reuse-pairing') && !hasFlag(args, '--dry-run')) {
      for (const action of stopAdapter(definition.name, definition.paths)) console.log(action)
    }
    recordInstallProvenance({
      kind: definition.name,
      version: definition.version,
      args,
      env: process.env,
    })
    const helpers = installHelpers(definition)
    if (definition.install) await definition.install(args, helpers)
    else await helpers.pair(args)
    if (!hasFlag(args, '--dry-run') && !hasFlag(args, '--help') && !hasFlag(args, '-h')) {
      const result = recordAdapterInstall({
        name: definition.name,
        version: definition.version,
        args,
        paired: Boolean(readAdapterConfig<THarness>(definition.paths)),
      })
      if (result?.link) console.log(`link ${result.link.path}`)
      if (result?.warning) console.error(`warn ${result.warning}`)
    }
    return
  }
  if (command === 'uninstall') {
    if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
      if (definition.uninstall) await definition.uninstall(args)
      else console.log(definition.help ?? defaultHelp(definition))
      return
    }
    if (definition.uninstall) {
      await definition.uninstall(args)
      forgetAdapterInstall(definition.name)
      return
    }
    for (const action of uninstallAdapter(definition, args)) console.log(action)
    forgetAdapterInstall(definition.name)
    return
  }
  if (command === 'status') {
    await status(definition)
    return
  }
  if (command === 'upgrade') {
    await upgrade(definition, args)
    return
  }
  if (command === 'clara') {
    const host = await readHostIdentity()
    await runClaraCommand(
      {
        name: definition.name,
        nativeStatus: () => status(definition),
        containerized: Boolean(host.container),
      },
      args
    )
    return
  }
  if (command === 'verify') {
    await verify(definition, args)
    return
  }
  if (command === 'start') {
    await start(definition)
    return
  }
  if (command === 'stop') {
    for (const action of stopAdapter(definition.name, definition.paths)) console.log(action)
    return
  }
  if (command === 'logs') {
    console.log(tailAdapterLog(definition.paths, Number(argValue(args, '--lines') ?? 80)))
    return
  }
  if (command === 'config-path') {
    console.log(definition.paths.configPath)
    console.log(definition.paths.identityPath)
    return
  }
  if (command === 'apply-update') {
    await applyAdapterUpdate(
      { kind: definition.name, label: definition.label, paths: definition.paths },
      args
    )
    return
  }
  throw new Error(`unknown command: ${command}`)
}

/**
 * A relay connection requires a stored grant. Grants cannot be repaired
 * locally, so the only recovery is installing with a fresh pairing code.
 */
export function requireRelayGrant(wsUrl: string, grant: string | undefined): void {
  if (!isLocalHubUrl(wsUrl) && !grant) throw new Error(REINSTALL_GRANT_MESSAGE)
}

async function serve<THarness>(
  definition: AdapterDefinition<THarness>,
  args: string[]
): Promise<void> {
  const config = readAdapterConfig<THarness>(definition.paths)
  if (!config) {
    throw new Error(
      `No adapter config at ${definition.paths.configPath}. Run: ${adapterInstallCommand(
        definition.name,
        selfEntry()
      )}`
    )
  }
  const probe = await definition.probe(config, 3_000)
  writeAdapterPid(definition.paths)
  process.once('exit', () => clearAdapterPid(definition.paths))
  const recorded = ensureAdapterRecord({
    name: definition.name,
    version: definition.version,
    paired: true,
  })
  if (recorded?.warning) console.error(`[adapter] ${recorded.warning}`)
  const info: AdapterInfo = {
    adapter: { name: definition.name, version: definition.version },
    harness: {
      kind: definition.name,
      ...(probe.version ? { version: probe.version } : {}),
    },
    capabilities: definition.capabilities,
  }
  const host = await readHostIdentity()
  const app = await definition.createApp({ config, probe, info })
  const hostMetrics = createHostMetrics({
    roots: [
      { label: 'Adapter data', path: definition.paths.dataDir },
      { label: 'Adapter config', path: definition.paths.configDir },
    ],
  })
  app.route('/', hostMetrics.routes)
  registerAdapterUpdateRoutes(app, {
    kind: definition.name,
    label: definition.label,
    version: definition.version,
    paths: definition.paths,
    containerized: Boolean(host.container),
  })
  const harness = definition.describe(config)
  const wsUrl =
    argValue(args, '--ws-url') ?? process.env.CLARA_ADAPTER_WS_URL?.trim() ?? config.wsUrl
  // A relay connection proves access with a grant. There is no legacy token to
  // fall back to, so an old config must be paired again.
  requireRelayGrant(wsUrl, config.grant)
  const persistGrant = (state: RelayGrantState) => {
    const current = readAdapterConfig<THarness>(definition.paths)
    if (!current || current.grant === state.grant) return
    writeAdapterConfig(definition.paths, { ...current, grant: state.grant })
  }
  let hubInfo: AdapterLiveState['hubInfo']
  const orchestratorRef: { current?: EngineOrchestrator } = {}
  let writeLive: () => void = () => {}
  const rememberHubInfo = (info: AgentInfo) => {
    const engine = info.engine ? { ...info.engine } : undefined
    // The status file is readable by the adapter user; the token belongs in
    // engine.token and engine.json, not in a diagnostics snapshot.
    if (engine) delete engine.token
    hubInfo = {
      version: info.version,
      protocol: info.protocol,
      ...(info.room ? { room: info.room } : {}),
      ...(info.endpoints ? { endpoints: info.endpoints } : {}),
      ...(engine ? { engine } : {}),
      updatedAt: Date.now(),
    }
    writeLive()
    void orchestratorRef.current?.update(info.engine).catch((cause) => {
      console.error(`[adapter] could not resolve the engine endpoint: ${describeError(cause)}`)
    })
  }
  const transport = new AdapterTransport({
    wsUrl,
    grant: config.grant,
    identity: { harnessId: config.harnessId, adapterId: config.adapterId, key: config.key },
    kind: definition.name,
    label: config.label ?? definition.label,
    info: {
      adapterVersion: definition.version,
      protocolVersion: HARNESS_PROTOCOL_VERSION,
      ...(probe.version ? { harnessVersion: probe.version } : {}),
      capabilities: definition.capabilities,
      ...(Object.keys(host).length > 0 ? { host } : {}),
    },
    handler: async (request) => app.fetch(request),
    onRelayGrant: persistGrant,
    onHubInfo: rememberHubInfo,
    log: (message, detail) => {
      console.error(`[adapter] ${message}`)
      if (process.env.CLARA_ADAPTER_DEBUG === '1' && detail !== undefined) {
        console.error(detail)
      }
    },
  })
  orchestratorRef.current = new EngineOrchestrator({
    transport,
    log: (message, detail) => {
      console.error(`[adapter] ${message}`)
      if (process.env.CLARA_ADAPTER_DEBUG === '1' && detail !== undefined) {
        console.error(detail)
      }
    },
  })
  const startedAt = Date.now()
  let current = probe
  let checkedAt = startedAt
  let probing = false
  writeLive = () => {
    const status = transport.status
    const state: AdapterLiveState = {
      pid: process.pid,
      startedAt,
      updatedAt: Date.now(),
      harnessId: config.harnessId,
      ...(hubInfo ? { hubInfo } : {}),
      hub: {
        url: wsUrl,
        status: status.status,
        connected: status.connected,
        authenticated: status.authenticated,
        ...(status.lastFrameAt ? { lastFrameAt: status.lastFrameAt } : {}),
        ...(status.lastError ? { lastError: status.lastError } : {}),
        ...(status.lastDisconnect ? { lastDisconnect: status.lastDisconnect } : {}),
      },
      harness: {
        url: harness.url,
        reachable: current.ok,
        ...(current.version ? { version: current.version } : {}),
        code: current.code,
        latencyMs: current.latencyMs,
        checkedAt,
        ...(current.message ? { message: current.message } : {}),
      },
    }
    try {
      writeState(definition.paths.statePath, state)
    } catch (cause) {
      console.error(`[adapter] could not write status: ${describeError(cause)}`)
    }
  }

  transport.start()
  hostMetrics.start()
  writeLive()
  // The adapter is a long-running service. This timer stays referenced so a
  // disconnected hub cannot empty the event loop and exit the process; the
  // transport owns reconnecting, and the state file keeps reporting it.
  const statusTimer = setInterval(writeLive, 2_000)
  const healthTimer = setInterval(() => {
    if (probing) return
    probing = true
    void definition
      .probe(config, 2_000)
      .then((next) => {
        current = next
        checkedAt = Date.now()
        writeLive()
      })
      .finally(() => {
        probing = false
      })
  }, 10_000)
  healthTimer.unref()

  console.log(
    `Clara ${definition.label} adapter ${definition.version} connecting to ${wsUrl} as ${config.harnessId}`
  )
  const stop = () => {
    clearInterval(statusTimer)
    clearInterval(healthTimer)
    hostMetrics.stop()
    transport.close()
    writeLive()
    void orchestratorRef.current?.close().finally(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

export async function pair<THarness>(
  definition: AdapterDefinition<THarness>,
  args: string[]
): Promise<AdapterConfig<THarness>> {
  const input = await pairingInput(args)
  if (input.kind !== definition.name) {
    throw new Error(`This pairing code is for ${input.kind}, not ${definition.label}`)
  }
  const identity = loadIdentity(definition.paths.identityPath)
  const harness = await definition.resolveHarness(args)
  const config: AdapterConfig<THarness> = {
    ...identity,
    wsUrl: input.wsUrl,
    // Only the enrollment grant is known before the hub answers.
    grant: input.grant ?? '',
    ...harness,
    label: definition.label,
  }
  const probe = await definition.probe(config, 3_000)
  const enrolled = await enrollAdapter({
    wsUrl: input.wsUrl,
    ...(input.grant ? { grant: input.grant } : {}),
    enrollId: input.enrollId,
    enrollToken: input.enrollToken,
    harnessId: identity.harnessId,
    kind: input.kind,
    label: definition.label,
    adapterId: identity.adapterId,
    key: identity.key,
    adapterVersion: definition.version,
    ...(probe.version ? { harnessVersion: probe.version } : {}),
    capabilities: definition.capabilities,
  })
  // Enrollment hands back the first long-lived adapter grant. The enrollment
  // grant must never be stored as the steady-state credential.
  const grant = enrolled.relayGrant?.grant ?? (isLocalHubUrl(input.wsUrl) ? '' : undefined)
  if (grant === undefined) throw new Error(REINSTALL_GRANT_MESSAGE)
  writeAdapterConfig(definition.paths, { ...config, grant })
  console.log(
    `Paired ${input.kind} adapter ${identity.harnessId} as connection ${enrolled.connectionId}` +
      (enrolled.reconnected ? ' (reconnected)' : '')
  )
  console.log(`Config: ${definition.paths.configPath}`)
  console.log(`Start it with: ${adapterStartCommand(definition.name, selfEntry())}`)
  return config
}

function installHelpers<THarness>(
  definition: AdapterDefinition<THarness>
): AdapterInstallHelpers<THarness> {
  return {
    paths: definition.paths,
    entry: selfEntry(),
    pair: (args) => pair(definition, args),
    config: () => readAdapterConfig<THarness>(definition.paths),
    writeConfig: (config) => writeAdapterConfig(definition.paths, config),
    installService: () =>
      installAdapterService({
        name: definition.name,
        label: definition.label,
        entry: selfEntry(),
        paths: definition.paths,
      }),
  }
}

async function start<THarness>(definition: AdapterDefinition<THarness>): Promise<void> {
  if (!readAdapterConfig(definition.paths)) {
    throw new Error(
      `No adapter config at ${definition.paths.configPath}. Run: ${adapterInstallCommand(
        definition.name,
        selfEntry()
      )}`
    )
  }
  if (adapterServiceActive(definition.name)) {
    console.log(`adapter service is already running (${adapterServiceKind(definition.name)})`)
    return
  }
  const service = adapterServiceKind(definition.name)
  if (service !== 'none') {
    const started = startAdapterService(definition.name)
    console.log(
      started
        ? `start ${service} service`
        : `could not start the ${service} service; check its logs`
    )
    return
  }
  const result = startAdapterProcess({
    name: definition.name,
    label: definition.label,
    entry: selfEntry(),
    paths: definition.paths,
  })
  for (const action of result.actions) console.log(action)
  const status = adapterProcessStatus(definition.paths)
  if (status.running) console.log(`adapter running (pid ${status.pid})`)
  else console.log(`adapter did not start; check ${status.log}`)
}

async function verify<THarness>(
  definition: AdapterDefinition<THarness>,
  args: string[]
): Promise<void> {
  const config = readAdapterConfig<THarness>(definition.paths)
  if (!config) {
    const report: AdapterVerifyReport = {
      adapter: definition.name,
      label: definition.label,
      checks: [
        {
          name: 'config',
          status: 'skip',
          detail: `adapter is not installed at ${definition.paths.configPath}`,
        },
      ],
    }
    if (hasFlag(args, '--json')) console.log(JSON.stringify(report, null, 2))
    else printVerifyReport(report)
    return
  }
  if (!definition.verify) {
    throw new Error(`${definition.label} does not support verify`)
  }
  const report = await definition.verify(config, {
    ...(argValue(args, '--directory') ? { directory: argValue(args, '--directory') } : {}),
    write: hasFlag(args, '--write'),
  })
  if (hasFlag(args, '--json')) console.log(JSON.stringify(report, null, 2))
  else printVerifyReport(report)
  if (report.checks.some((check) => check.status === 'fail')) process.exitCode = 1
}

function printVerifyReport(report: AdapterVerifyReport): void {
  const harness = report.harness ? ` (${report.harness})` : ''
  console.log(`${report.label} adapter verification${harness}`)
  for (const check of report.checks) {
    const mark = check.status === 'ok' ? 'ok  ' : check.status === 'skip' ? 'skip' : 'FAIL'
    console.log(`${mark} ${check.name}${check.detail ? `: ${check.detail}` : ''}`)
  }
  const count = (status: AdapterVerifyStatus) =>
    report.checks.filter((check) => check.status === status).length
  console.log(`\n${count('ok')} ok, ${count('skip')} skipped, ${count('fail')} failed`)
}

async function status<THarness>(definition: AdapterDefinition<THarness>): Promise<void> {
  const config = readAdapterConfig<THarness>(definition.paths)
  const identity = loadIdentity(definition.paths.identityPath)
  console.log(`adapter:  ${definition.name} ${definition.version}`)
  console.log(`harness:  ${identity.harnessId}`)
  console.log(`credential: ${identity.adapterId}`)
  if (!config) {
    console.log('config:   missing')
    return
  }
  const described = definition.describe(config)
  console.log(`config:   ${definition.paths.configPath}`)
  console.log(`ws:       ${config.wsUrl}`)
  console.log(`${definition.name}: ${described.url}`)
  const processStatus = adapterProcessStatus(definition.paths)
  const serviceActive = adapterServiceActive(definition.name)
  const running = processStatus.running || serviceActive
  console.log(
    `process:  ${
      serviceActive
        ? `running (${adapterServiceKind(definition.name)} service)`
        : processStatus.running
          ? `running (pid ${processStatus.pid})`
          : 'stopped'
    }`
  )
  const live = readState(definition.paths.statePath)
  if (live && running) {
    console.log(`hub:      ${live.hub.status} (${live.hub.url})`)
    console.log(
      `link:     ${live.hub.authenticated ? 'authenticated' : live.hub.connected ? 'handshake complete' : 'not authenticated'}` +
        (live.hub.lastFrameAt ? `, last frame ${formatAge(live.hub.lastFrameAt)}` : '')
    )
    if (live.hub.lastError) console.log(`hub error: ${live.hub.lastError}`)
    if (live.hub.lastDisconnect) {
      const closed = live.hub.lastDisconnect
      console.log(`last close: ${closed.code} ${closed.reason} (${formatAge(closed.at)})`)
    }
    if (live.hubInfo) {
      console.log(`hub version: ${live.hubInfo.version}`)
      if (live.hubInfo.endpoints?.web) console.log(`web:      ${live.hubInfo.endpoints.web}`)
      if (live.hubInfo.endpoints?.engine) console.log(`engine:   ${live.hubInfo.endpoints.engine}`)
      if (live.hubInfo.engine) {
        const engine = live.hubInfo.engine
        console.log(
          `engine bridge: ${engine.enabled ? (engine.proxy ? 'direct or proxy' : 'direct only') : 'off'}` +
            (engine.reachable ? ' (hub reachable)' : ' (hub unreachable)')
        )
      }
    }
    const health = live.harness
    console.log(
      `health:   ${health.reachable ? 'reachable' : 'unreachable'} (${health.code ?? 'unknown'}` +
        `${health.version ? `, ${health.version}` : ''}` +
        `${health.checkedAt ? `, checked ${formatAge(health.checkedAt)}` : ''})`
    )
    if (health.message) console.log(`${definition.name} error: ${health.message}`)
  } else if (live) {
    console.log(`live:     stale (last ${live.hub.status}, updated ${formatAge(live.updatedAt)})`)
  }
  const update = readAdapterUpdateStatus(definition.paths)
  console.log(
    `update:   ${update.state}` +
      (update.from && update.to ? ` (${update.from} -> ${update.to})` : '') +
      (update.error ? `: ${update.error}` : '')
  )
  console.log(`log:      ${processStatus.log}`)
  const probe = await definition.probe(config, 3_000)
  if (definition.statusLines) {
    for (const line of definition.statusLines(config, probe)) console.log(line)
  }
  console.log(
    `reachable: ${probe.ok ? `yes${probe.version ? ` (${probe.version})` : ''}` : `no (${probe.code})`}`
  )
}

async function upgrade<THarness>(
  definition: AdapterDefinition<THarness>,
  args: string[]
): Promise<void> {
  const host = await readHostIdentity()
  const target = {
    kind: definition.name,
    label: definition.label,
    version: definition.version,
    paths: definition.paths,
    containerized: Boolean(host.container),
  }
  const json = hasFlag(args, '--json')
  const check = await checkAdapterUpdate(target)
  if (hasFlag(args, '--check')) {
    if (json) console.log(JSON.stringify(check, null, 2))
    else {
      console.log(`current   ${check.current}`)
      console.log(`latest    ${check.latest}`)
      console.log(
        check.available
          ? 'An update is available. Run the same command without --check to install it.'
          : 'The adapter is up to date.'
      )
    }
    return
  }
  if (!check.available) {
    if (json) console.log(JSON.stringify({ ...check, changed: false }, null, 2))
    else console.log(`Clara ${definition.label} adapter ${definition.version} is up to date.`)
    return
  }
  const result = await stageAdapterUpdate(target)
  if (json) console.log(JSON.stringify({ ...check, ...result, changed: true }, null, 2))
  else
    console.log(
      `Clara ${definition.label} adapter update ${result.from} -> ${result.to} staged; ` +
        'it restarts through its supervisor.'
    )
}

function uninstallAdapter<THarness>(
  definition: AdapterDefinition<THarness>,
  args: string[]
): string[] {
  const actions = removeAdapterService({
    name: definition.name,
    label: definition.label,
    entry: selfEntry(),
    paths: definition.paths,
  })
  removeAdapterConfig(definition.paths)
  if (hasFlag(args, '--purge')) {
    removeIdentity(definition.paths)
    actions.push('remove harness identity and credential')
  }
  return [...actions, `remove adapter config ${definition.paths.configPath}`]
}

export type AdapterInstallPairing = {
  /** The hub WebSocket URL the adapter connects to. */
  wsUrl: string
  /** The existing or enrollment grant; the installer stores the long-lived one. */
  grant?: string
  /** Present when the adapter must enroll a new identity. */
  enroll?: { enrollId: string; enrollToken: string }
  /** True when an existing config supplied the connection instead of a code. */
  reused: boolean
}

/**
 * Resolve the connection for an adapter install. A reinstall reuses the saved
 * config and skips enrollment; a fresh install consumes a pairing code.
 */
export async function resolveInstallPairing(input: {
  name: string
  label: string
  paths: AdapterPaths
  pair?: string
  reuse?: boolean
}): Promise<AdapterInstallPairing> {
  if (input.reuse) {
    const config = readAdapterConfig<unknown>(input.paths)
    if (!config?.wsUrl) {
      throw new Error(
        `No existing ${input.label} pairing. Run: ${adapterInstallCommand(input.name, selfEntry())}`
      )
    }
    return {
      wsUrl: config.wsUrl,
      ...(config.grant ? { grant: config.grant } : {}),
      reused: true,
    }
  }
  if (!input.pair && !stdin.isTTY) {
    throw new Error('Pass --pair <code> in a non-interactive install')
  }
  const pairing = await pairingInput(input.pair ? ['--pair', input.pair] : [])
  if (pairing.kind !== input.name) {
    throw new Error(`This pairing code is for ${pairing.kind}, not ${input.label}`)
  }
  return {
    wsUrl: pairing.wsUrl,
    ...(pairing.grant ? { grant: pairing.grant } : {}),
    enroll: { enrollId: pairing.enrollId, enrollToken: pairing.enrollToken },
    reused: false,
  }
}

export async function pairingInput(args: string[]): Promise<HarnessPairingPayload> {
  const value = argValue(args, '--pair') ?? (await prompt('Pairing code: '))
  const parsed = parseHarnessPairingInput(value)
  if (!parsed) throw new Error('That is not a valid Clara harness pairing code')
  if (parsed.expiresAt <= Date.now()) throw new Error('That pairing code has expired')
  return parsed
}

export async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

export function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

export function formatAge(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1_000))
  if (seconds < 2) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

export function defaultHelp<THarness>(definition: AdapterDefinition<THarness>): string {
  const bin = `clara-adapter-${definition.name}`
  return `Clara ${definition.label} adapter

Usage:
  ${bin} install [--pair <code>] [options]
  ${bin} pair [--pair <code>] [options]
  ${bin} serve
  ${bin} start|stop|logs [--lines <n>]
  ${bin} status
  ${bin} verify [--directory <path>] [--write] [--json]
  ${bin} uninstall
  ${bin} config-path

The adapter connects out to the hub over the same WebSocket and E2EE session
as the browser. It never listens on an inbound port.`
}
