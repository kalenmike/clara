import { join, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ENROLLMENT_GRANT_TTL_SECONDS,
  HARNESS_PAIRING_CODE_PREFIX,
  PROTOCOL_VERSION,
  createRelayGrant,
  encodeHarnessPairingCode,
  type AgentInfo,
  type HarnessPairingPayload,
} from '@clara/shared-types'
import { baseURL } from '@clara/service-control'
import {
  acquireRuntimeLock,
  isRuntimeLive,
  readRuntimeState,
  stopRuntimeState,
  writeRuntimeState,
  type RuntimeState,
} from '@clara/runtime-state'
import {
  applyRelayCredentials,
  loadAdminPaths,
  loadConfig,
  readRelayTarget,
  saveRelayTarget,
  type ServerConfig,
} from './config.ts'
import { labEndpoint } from './lab/service.ts'
import { loadCloudflareDeploymentFeature } from './features/cloudflare-deployment/loader.ts'
import { HarnessManager } from './harness/manager.ts'
import { HarnessMetadataStore } from './harness/metadata.ts'
import { HarnessStore } from './harness/store.ts'
import { ProjectStore } from './projects/store.ts'
import { PanelAuth } from './panel/auth.ts'
import { InstallRegistry } from './panel/install-registry.ts'
import { InstallService } from './panel/install-service.ts'
import { PanelLog } from './panel/log.ts'
import { PanelRuntime } from './panel/runtime.ts'
import { startPanelServer, type PanelServer } from './panel/server.ts'
import { readSetupToken, readSetupTokenFromEnv } from './panel/setup-token.ts'
import { printPairing, relayWsUrl } from './pairing.ts'
import {
  dockerBridgeAddresses,
  isLoopbackHost,
  isWildcardHost,
  wsUrl as directWsUrl,
} from './runtime/addresses.ts'
import { PushService } from './push/service.ts'
import { SessionMonitor } from './sessions/monitor.ts'
import { clearPushSubscriptions, PushSubscriptionStore } from './push/store.ts'
import { loadVapidDetails } from './push/vapid.ts'
import { RuntimeController } from './runtime/controller.ts'
import { ClientStorageStore } from './store/client-storage.ts'
import { closeDatabase, openDatabase, schemaVersion } from './store/database.ts'
import { DeviceStore } from './store/devices.ts'
import { PanelUserStore } from './store/panel-users.ts'
import type { PanelEndpoint } from './api/context.ts'
import { readApiToken } from './api/token.ts'
import { loadRelayCredentials, saveRelayCredentials } from './store/relay.ts'
import { readSecretKey } from './store/secret-key.ts'
import { SettingsStore } from './store/settings.ts'
import { SERVER_VERSION } from './version.ts'

const panelLog = new PanelLog()
const DEFAULT_PANEL_PORT = 8790

/**
 * Run the hub command. The packaged `clara` binary dispatches into this
 * function, while the `clara-server` bin keeps reading its own argv.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = [...argv]
  const command = args[0] ?? 'serve'

  if (command === 'admin') {
    await runAdmin(args.slice(1))
    return
  }

  if (command === 'setup') {
    await runSetup(args.slice(1))
    return
  }

  if (command === 'pair-adapter') {
    await runPairAdapter(args.slice(1))
    return
  }

  if (command === 'health') {
    await runHealth()
    return
  }

  if (command !== 'serve' && command !== 'pair') {
    console.error(`Unknown command: ${command}`)
    console.error('Usage: clara-server [serve|setup|pair|pair-adapter|admin|health] [--no-panel]')
    console.error('       clara-server setup [--username <name>] [--password-stdin]')
    console.error('       clara-server pair [--no-relay] [--no-qr] [--revoke-all|--revoke <id>]')
    console.error(
      '       clara-server pair-adapter --kind <kind> [--transport local|relay|docker] [--ws-url <url>] [--json]'
    )
    console.error('       clara-server admin reset|setup-token')
    console.error('       clara-server health')
    process.exitCode = 2
    return
  }

  // A local-only code is a pairing command option; serving must keep its relay
  // config so the outbound transport still starts.
  const noRelay = command === 'pair' && args.includes('--no-relay')

  if (command === 'pair') {
    const previous = readRuntimeState()
    const live = isRuntimeLive(previous) ? previous : undefined
    const config = loadConfig({
      noRelay,
      ...(live?.local ? { localPortHint: live.local.port } : {}),
    })
    if (live?.local) {
      config.local.host = live.local.host
      config.local.port = live.local.port
      config.sources.localHost = 'runtime'
      config.sources.localPort = 'runtime'
    }
    await runPair(config, args, noRelay)
    return
  }

  // Serving owns one runtime file per data directory, so a second hub cannot
  // open the same SQLite database and fight over the same ports.
  const lock = acquireRuntimeLock()
  if (!lock.acquired) {
    const previous = readRuntimeState()
    if (previous?.panel) console.log(`panel: ${previous.panel.url}`)
    if (previous?.local) console.log(`local: ${previous.local.url}`)
    console.error('The Clara hub is already running. Open the panel above.')
    process.exitCode = 1
    return
  }

  const previous = readRuntimeState()
  let published = false
  let finalized = false
  const finalize = () => {
    if (finalized) return
    finalized = true
    if (published) stopRuntimeState()
    lock.release()
  }

  try {
    const config = loadConfig({
      ...(previous?.local ? { localPortHint: previous.local.port } : {}),
    })
    await runServe(
      config,
      args,
      finalize,
      () => {
        published = true
      },
      previous?.panel?.port
    )
  } catch (cause) {
    finalize()
    throw cause
  }
}

async function runServe(
  config: ServerConfig,
  args: string[],
  finalize: () => void,
  markPublished: () => void,
  panelPortHint?: number
): Promise<void> {
  const database = openDatabase(config.dbPath)
  const secretKey = await readSecretKey(config.configDir)
  let storedCredentials = await loadRelayCredentials(config.configDir, secretKey)
  const legacyAgentToken =
    config.sources.agentToken === 'file' ? config.relay?.agentToken : undefined
  if (legacyAgentToken) {
    const credentials = {
      agentToken: legacyAgentToken || storedCredentials?.agentToken,
    }
    try {
      await saveRelayCredentials(config.configDir, secretKey, credentials)
      saveRelayTarget(config.configPath, readRelayTarget(config.configPath))
      storedCredentials = credentials
      log('moved the legacy relay token from server.json into encrypted storage')
    } catch (cause) {
      log('could not move the legacy relay token into encrypted storage', cause)
    }
  }
  applyRelayCredentials(config, storedCredentials)
  const cloudflare = await loadCloudflareDeploymentFeature({
    config,
    secretKey,
    log,
  })
  if (config.relay && !config.relay.agentToken) {
    log(
      'relay is configured but its hub token is missing; the hub will run local-only until it is saved in the Relay card'
    )
  }
  const devices = new DeviceStore({
    db: database,
    key: secretKey.key,
    keyVersion: secretKey.version,
  })

  const settings = new SettingsStore(database)
  const clientStorage = new ClientStorageStore(database)
  const initial = settings.get()

  const harnessStore = new HarnessStore({
    db: database,
    key: secretKey.key,
    keyVersion: secretKey.version,
  })
  const projects = new ProjectStore(database)
  const harnessMetadata = new HarnessMetadataStore(database, projects)
  const harness = new HarnessManager(harnessStore, harnessMetadata, projects)
  await harness.load()

  const panelEnabled = !args.includes('--no-panel') && process.env.CLARA_PANEL_DISABLED !== '1'
  const auth = new PanelAuth({
    users: new PanelUserStore(database),
    configDir: config.configDir,
    secureCookie: readBooleanEnv('CLARA_PANEL_SECURE_COOKIE'),
  })

  // CI and a future hosted gateway can create the owner before the process
  // starts serving. This is the only non-interactive owner path; the hub still
  // starts transports only after an owner exists.
  const owner = readOwnerEnv()
  if (!auth.configured() && owner) {
    try {
      await auth.createOwner(owner.username, owner.password)
      log(`owner account "${owner.username}" created from the environment`)
    } catch (cause) {
      throw new Error(
        `Could not create the owner account from the environment: ${errorText(cause)}`,
        {
          cause,
        }
      )
    }
  }

  try {
    const setup = auth.ensureSetupToken()
    if (setup?.fromEnv) log('a host setup token is required to claim this hub')
  } catch (cause) {
    log('the host setup token could not be registered', cause)
  }

  const setupRequired = !auth.configured()
  if (setupRequired && !panelEnabled) {
    throw new Error(
      'No owner account exists and the hub panel is disabled. Set CLARA_ADMIN_PASSWORD or enable the panel to create one.'
    )
  }
  if (setupRequired) {
    log('owner setup is required; no hub transport will start until it is complete')
  }

  const opencodeVersion =
    setupRequired || initial.stopped || !initial.features.opencode || !harness.configured
      ? undefined
      : harness.list().find((connection) => connection.online && connection.harnessVersion)
          ?.harnessVersion
  const startedAt = Date.now() - Math.round(process.uptime() * 1000)

  let apiToken = ''
  try {
    const token = readApiToken(config.configDir)
    apiToken = token.token
    if (token.source === 'generated') log(`api token generated at ${token.path}`)
    else if (token.path) log(`api token read from ${token.path}`)
  } catch (cause) {
    log('api token unavailable; the loopback API is disabled', cause)
  }

  let push: PushService | undefined
  let pushError: string | undefined
  try {
    const vapid = loadVapidDetails(config.configDir)
    const store = new PushSubscriptionStore(join(config.configDir, 'subscriptions.json'), log)
    push = new PushService({
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
      subject: vapid.subject,
      store,
      log,
    })
    if (push.storageError) log('push subscription storage is unavailable', push.storageError)
    else log(`push ready (${push.count} device(s))`)
  } catch (cause) {
    pushError = cause instanceof Error ? cause.message : String(cause)
    log('push disabled', cause)
  }

  const info: AgentInfo = {
    version: SERVER_VERSION,
    protocol: PROTOCOL_VERSION,
    opencodeVersion,
    room: config.relay?.room,
    pushPublicKey: push?.publicKey,
    orchestration: false,
    endpoints: {
      web: config.pairingBaseUrl,
      hub: `http://${config.local.host}:${config.local.port}`,
      engine: baseURL(),
    },
  }

  const panelBindHost = process.env.CLARA_PANEL_BIND_HOST?.trim() || '127.0.0.1'
  let panel: PanelServer | undefined
  // The API app exists before the panel starts, so the bridge asks for the
  // listener lazily; a disabled or failed panel resolves to undefined.
  const panelTarget = (): PanelEndpoint | undefined =>
    panel ? { host: advertisedHost(panelBindHost, '127.0.0.1'), port: panel.port } : undefined
  const controllerRef: { current?: RuntimeController } = {}
  const publishRuntime = () => {
    const localPort = controllerRef.current?.localPort
    // The listener may fall back to an ephemeral port; advertise the live one.
    if (localPort && info.endpoints) info.endpoints.hub = `http://${config.local.host}:${localPort}`
    const state = runtimeState(config, startedAt, localPort, panel)
    try {
      writeRuntimeState(state)
      markPublished()
    } catch (cause) {
      log('could not publish the runtime state', cause)
    }
  }

  const installRegistry = new InstallRegistry({ config, log })
  const install = new InstallService({
    config,
    registry: installRegistry,
    isEnabled: () => settings.getInstall(),
    log,
  })

  const controller = new RuntimeController({
    config,
    harness,
    info,
    settings,
    install,
    sync: clientStorage,
    push,
    pushError,
    devices,
    startedAt,
    apiToken,
    secretKey,
    panel: panelTarget,
    lab: labEndpoint,
    onRelayTargetChanged: () => cloudflare?.forgetDeployment(),
    onLocalEndpointChange: publishRuntime,
    log,
  })
  controllerRef.current = controller

  let started = false
  const startHub = async () => {
    if (started) return
    started = true
    await controller.start()
    cloudflare?.attachRuntime({ controller, settings })
    if (apiToken) {
      log(
        `api at http://${config.local.host === '0.0.0.0' ? '127.0.0.1' : config.local.host}:${config.local.port} (docs /docs)`
      )
    }

    if (!initial.stopped) {
      if (!harness.configured) {
        log('no harness connection is configured; open the panel to set one up')
      } else if (opencodeVersion) {
        log(`a paired harness reported ${opencodeVersion}`)
      } else if (initial.features.opencode && !setupRequired) {
        log('no paired harness has reported a version yet')
      }
    }
  }

  if (!setupRequired) await startHub()

  if (panelEnabled) {
    const sessionMonitor = new SessionMonitor({
      harness,
      canAccess: () => controller.canProxy(),
      log,
    })
    const runtime = new PanelRuntime({
      config,
      harness,
      sessions: sessionMonitor,
      localAgent: controller.agent,
      relayAgent: () => controller.relay,
      relayClient: () => controller.relayTransport,
      localConnections: () => controller.localConnections,
      localAddresses: () => controller.localAddresses,
      traffic: controller.traffic,
      push,
      pushError,
      devices: () => controller.devices(),
      pairedDevices: () => controller.pairedDevices(),
      startedAt,
      controls: () => controller.controls(),
      probeEnabled: () => controller.canProxy(),
      secretKey: { ...(secretKey.path ? { path: secretKey.path } : {}), source: secretKey.source },
      database: {
        path: config.dbPath,
        schemaVersion: schemaVersion(database),
        sync: () => clientStorage.stats(),
      },
      feature: cloudflare?.panel,
      log: panelLog,
    })
    const assetsDir =
      process.env.CLARA_PANEL_ASSETS_DIR?.trim() ||
      join(dirname(fileURLToPath(import.meta.url)), 'panel')
    try {
      panel = await startPanelServer({
        source: runtime,
        controls: controller,
        install,
        feature: cloudflare?.panel,
        auth,
        host: panelBindHost,
        allowRemote: readBooleanEnv('CLARA_PANEL_ALLOW_REMOTE'),
        port: parsePanelPort(process.env.CLARA_PANEL_PORT, panelPortHint),
        assetsDir,
        onSetupComplete: async () => {
          await startHub()
          publishRuntime()
        },
        log,
      })
      log(`panel at ${panel.url}`)
      if (setupRequired) {
        log('open the panel to create the owner account; the hub starts after that')
      }
    } catch (cause) {
      if (setupRequired) {
        throw new Error(
          'The hub panel is required to create the owner account, but it could not start.',
          { cause }
        )
      }
      log('panel unavailable', cause)
    }
  }

  publishRuntime()

  log(`database at ${config.dbPath}`)
  log(`pairing config: ${config.configPath}`)
  if (setupRequired) {
    log('create the owner account with the panel or `clara-server setup`')
  } else {
    log('print a pairing code with: clara-server pair')
    if (args.includes('--pair') || args.includes('--qr')) {
      await printPairing(config, devices, true, { noRelay: false })
    }
  }

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    log('shutting down')
    install.close()
    await controller.close()
    cloudflare?.close()
    await panel?.close()
    closeDatabase(database)
    finalize()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.on('unhandledRejection', (cause) => log('unhandled rejection', cause))

  if (readBooleanEnv('CLARA_CONTROL_STDIN')) {
    process.stdin.setEncoding('utf8')
    process.stdin.resume()
    process.stdin.on('data', (chunk) => {
      if (String(chunk).includes('shutdown')) void shutdown()
    })
    process.stdin.on('end', () => void shutdown())
  }
}

async function runPair(config: ServerConfig, args: string[], noRelay: boolean): Promise<void> {
  const database = openDatabase(config.dbPath)
  try {
    const users = new PanelUserStore(database)
    if (users.count() === 0) {
      console.error(
        'Create the hub owner account first: open the panel or run `clara-server setup`.'
      )
      process.exitCode = 1
      return
    }
    const secretKey = await readSecretKey(config.configDir)
    const storedCredentials = await loadRelayCredentials(config.configDir, secretKey)
    applyRelayCredentials(config, storedCredentials)
    const devices = new DeviceStore({
      db: database,
      key: secretKey.key,
      keyVersion: secretKey.version,
    })

    devices.pruneExpiredTokens()
    const revokeAll = args.includes('--revoke-all')
    const revokeIndex = args.indexOf('--revoke')
    if (revokeAll) {
      const removed = devices.revokeAllDevices()
      const pushRemoved = clearPushSubscriptions(join(config.configDir, 'subscriptions.json'))
      console.log(`Revoked ${removed} device(s); cleared ${pushRemoved} push subscription(s).`)
      console.log('Restart the running hub service to apply the revocation immediately.')
      return
    }
    if (revokeIndex >= 0) {
      const id = args[revokeIndex + 1]
      if (!id) {
        console.error('Usage: clara-server pair --revoke <deviceId>')
        process.exitCode = 2
        return
      }
      const revoked = devices.revokeDevice(id)
      if (!revoked) {
        console.error(`No device with id ${id}`)
        process.exitCode = 1
        return
      }
      console.log(`Revoked ${revoked.label} (${revoked.id}).`)
      console.log('Restart the running hub service to apply the revocation immediately.')
      return
    }
    await printPairing(config, devices, !args.includes('--no-qr'), { noRelay })
  } finally {
    closeDatabase(database)
  }
}

async function runPairAdapter(args: string[]): Promise<void> {
  const kind = readOption(args, '--kind') ?? readOption(args, '--harness')
  if (!kind) {
    console.error(
      'Usage: clara-server pair-adapter --kind <kind> [--transport local|relay|docker] [--ws-url <url>] [--json]'
    )
    process.exitCode = 2
    return
  }
  const transport = readOption(args, '--transport') ?? 'local'
  if (transport !== 'local' && transport !== 'relay' && transport !== 'docker') {
    console.error('--transport must be local, relay, or docker')
    process.exitCode = 2
    return
  }
  const label = readOption(args, '--label') ?? kind
  const wsUrlOverride = readOption(args, '--ws-url')

  const previous = readRuntimeState()
  const live = isRuntimeLive(previous) ? previous : undefined
  const config = loadConfig({
    ...(live?.local ? { localPortHint: live.local.port } : {}),
  })
  if (live?.local) {
    config.local.host = live.local.host
    config.local.port = live.local.port
    config.sources.localHost = 'runtime'
    config.sources.localPort = 'runtime'
  }

  const database = openDatabase(config.dbPath)
  try {
    const users = new PanelUserStore(database)
    if (users.count() === 0) {
      console.error(
        'Create the hub owner account first: open the panel or run `clara-server setup`.'
      )
      process.exitCode = 1
      return
    }
    const secretKey = await readSecretKey(config.configDir)
    const store = new HarnessStore({
      db: database,
      key: secretKey.key,
      keyVersion: secretKey.version,
    })
    const pairing = await store.createPairing({ kind, label })
    const relay = transport === 'relay' ? usableRelay(config.relay) : undefined
    if (transport === 'relay' && !relay) {
      console.error(
        'The relay URL or hub token is missing. Save both in the Relay card before pairing.'
      )
      process.exitCode = 1
      return
    }
    const room = relay ? relay.room : 'local'
    if (wsUrlOverride && transport !== 'relay' && !/^ws:\/\//i.test(wsUrlOverride)) {
      console.error('A direct pairing URL must start with ws://')
      process.exitCode = 1
      return
    }
    let wsUrl: string
    if (transport === 'relay' && relay) {
      wsUrl = relayWsUrl(relay.url, room)
    } else if (transport === 'docker') {
      const binds = config.localBindHosts ?? [config.local.bindHost]
      const bridge = dockerBridgeAddresses()[0]
      const custom = binds.find((host) => !isLoopbackHost(host) && !isWildcardHost(host))
      const host = custom ?? (binds.some(isWildcardHost) ? bridge : undefined)
      wsUrl =
        wsUrlOverride ||
        (isContainerized() ? `ws://server:${config.local.port}/ws` : '') ||
        (host ? directWsUrl(host, config.local.port) : '')
      if (!wsUrl) {
        console.error(
          'The hub has no container-reachable address. Allow Docker or LAN access from the panel, pass --ws-url, or configure the relay.'
        )
        process.exitCode = 1
        return
      }
    } else {
      wsUrl = wsUrlOverride ?? directWsUrl(config.local.host, config.local.port)
    }
    const grant = relay
      ? await createRelayGrant({
          room: relay.room,
          id: pairing.id,
          agentToken: relay.agentToken,
          ttlSeconds: ENROLLMENT_GRANT_TTL_SECONDS,
          kind: 'adapter',
        })
      : undefined
    const payload: HarnessPairingPayload = {
      v: PROTOCOL_VERSION,
      role: 'adapter',
      kind,
      wsUrl,
      room,
      enrollId: pairing.id,
      enrollToken: pairing.token,
      ...(grant ? { grant: grant.grant } : {}),
      fingerprint: pairing.fingerprint,
      expiresAt: pairing.expiresAt,
    }
    const code = `${HARNESS_PAIRING_CODE_PREFIX}${encodeHarnessPairingCode(payload)}`
    const result = {
      pairing: {
        id: pairing.id,
        kind,
        label,
        transport,
        code,
        wsUrl,
        room,
        fingerprint: pairing.fingerprint,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
        createdAt: new Date(pairing.createdAt).toISOString(),
      },
    }
    if (args.includes('--json')) {
      console.log(JSON.stringify(result))
    } else {
      console.log(code)
      console.log(`expires ${result.pairing.expiresAt}`)
    }
  } finally {
    closeDatabase(database)
  }
}

function usableRelay(relay: { url: string; room: string; agentToken: string } | undefined) {
  return relay?.url && relay.agentToken ? relay : undefined
}

async function runSetup(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: clara-server setup [--username <name>] [--password-stdin] [--url <panel>]')
    console.log('       clara-server setup --password <value> (not recommended; use stdin or env)')
    return
  }

  let password: string | undefined
  try {
    password = await readSetupPassword(args)
  } catch (cause) {
    console.error(errorText(cause))
    process.exitCode = 1
    return
  }
  if (!password) {
    console.error('Usage: clara-server setup [--username <name>] --password-stdin')
    console.error(
      'Or set CLARA_ADMIN_PASSWORD / CLARA_ADMIN_PASSWORD_FILE before starting the hub.'
    )
    process.exitCode = 2
    return
  }

  const username =
    readOption(args, '--username') ?? process.env.CLARA_ADMIN_USERNAME?.trim() ?? 'admin'
  const token = readOption(args, '--token') ?? process.env.CLARA_ADMIN_SETUP_TOKEN?.trim()
  const base = (
    readOption(args, '--url') ??
    process.env.CLARA_PANEL_URL?.trim() ??
    configuredPanelUrl()
  ).replace(/\/+$/, '')

  try {
    const sessionResponse = await fetch(`${base}/panel/api/v1/session`, {
      signal: AbortSignal.timeout(5_000),
    })
    if (!sessionResponse.ok) {
      throw new Error(`The panel answered ${sessionResponse.status} at ${base}`)
    }
    const session = (await sessionResponse.json()) as {
      authenticated?: boolean
      setupRequired?: boolean
      setupTokenRequired?: boolean
    }
    if (session.authenticated) {
      throw new Error('The hub already has an owner account')
    }
    if (session.setupRequired !== true) {
      throw new Error('The hub is already configured')
    }
    if (session.setupTokenRequired && !token) {
      throw new Error(
        'This hub requires a setup token. Pass --token or set CLARA_ADMIN_SETUP_TOKEN.'
      )
    }

    const response = await fetch(`${base}/panel/api/v1/setup`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-clara-panel': '1',
      },
      body: JSON.stringify({
        username,
        password,
        ...(token ? { token } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    const body = text ? (JSON.parse(text) as { error?: { message?: string } }) : undefined
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `The panel answered ${response.status}`)
    }

    if (args.includes('--json')) {
      console.log(JSON.stringify({ ok: true, username }))
    } else {
      console.log(`Owner account "${username}" created. The hub is starting.`)
    }
  } catch (cause) {
    console.error(`Could not create the owner account: ${errorText(cause)}`)
    console.error(
      'Start the hub first, then run this command, or set CLARA_ADMIN_PASSWORD before it starts.'
    )
    process.exitCode = 1
  }
}

async function readSetupPassword(args: string[]): Promise<string | undefined> {
  if (args.includes('--password-stdin')) {
    let text = ''
    for await (const chunk of process.stdin) text += String(chunk)
    return text.replace(/\r?\n$/, '')
  }
  const direct = readOption(args, '--password')
  if (direct !== undefined) return direct
  const env = readOwnerEnv()
  return env?.password
}

function readOption(args: string[], name: string): string | undefined {
  const prefix = `${name}=`
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === name) return args[index + 1]
    if (arg?.startsWith(prefix)) return arg.slice(prefix.length)
  }
  return undefined
}

function configuredPanelUrl(): string {
  const state = readRuntimeState()
  if (state?.panel?.url) return state.panel.url
  return `http://127.0.0.1:${parsePanelPort(process.env.CLARA_PANEL_PORT)}`
}

function readOwnerEnv(): { username: string; password: string } | undefined {
  const direct = process.env.CLARA_ADMIN_PASSWORD
  const file = process.env.CLARA_ADMIN_PASSWORD_FILE?.trim()
  let password = direct !== undefined && direct !== '' ? direct : undefined
  if (password === undefined && file) {
    try {
      password = readFileSync(file, 'utf8').replace(/\r?\n$/, '')
    } catch (cause) {
      throw new Error(`Could not read CLARA_ADMIN_PASSWORD_FILE at ${file}: ${errorText(cause)}`, {
        cause,
      })
    }
  }
  if (password === undefined || password === '') return undefined
  return {
    username: process.env.CLARA_ADMIN_USERNAME?.trim() || 'admin',
    password,
  }
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function runAdmin(args: string[]): Promise<void> {
  const action = args[0]
  const paths = loadAdminPaths()
  if (action === 'setup-token') {
    const token = readSetupTokenFromEnv() ?? readSetupToken(paths.configDir)
    if (!token) {
      console.error('No host setup token is configured.')
      console.error('Local setup needs no token: open the panel or run `clara-server setup`.')
      process.exitCode = 1
      return
    }
    console.log(token)
    return
  }

  if (action !== 'reset') {
    console.error('Usage: clara-server admin reset|setup-token')
    process.exitCode = 2
    return
  }

  const database = openDatabase(paths.dbPath)
  try {
    const auth = new PanelAuth({
      users: new PanelUserStore(database),
      configDir: paths.configDir,
    })
    const result = auth.resetForHost()
    console.log(`setup token written to ${result.path}`)
    console.log(result.token)
  } finally {
    closeDatabase(database)
  }
}

async function runHealth(): Promise<void> {
  const state = readRuntimeState()
  const port = state?.panel?.port ?? parsePanelPort(process.env.CLARA_PANEL_PORT)
  const url = `http://127.0.0.1:${port}/health`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) })
    const body = (await response.json().catch(() => undefined)) as { service?: unknown } | undefined
    if (response.ok && body?.service === 'clara-server') return
  } catch {
    // Fall through to the exit code below.
  }
  process.exitCode = 1
}

function runtimeState(
  config: ServerConfig,
  startedAt: number,
  localPort: number | undefined,
  panel: PanelServer | undefined
): RuntimeState {
  const localHost = advertisedHost(config.local.host, config.local.bindHost)
  const panelHost = advertisedHost(
    process.env.CLARA_PANEL_BIND_HOST?.trim() || '127.0.0.1',
    '127.0.0.1'
  )
  const now = new Date().toISOString()
  return {
    schema: 1,
    state: 'running',
    pid: process.pid,
    startedAt: new Date(startedAt).toISOString(),
    updatedAt: now,
    version: SERVER_VERSION,
    mode: isContainerized() ? 'container' : 'local',
    configDir: config.configDir,
    dataDir: config.dataDir,
    ...(localPort
      ? {
          local: {
            host: localHost,
            port: localPort,
            url: `http://${formatHost(localHost)}:${localPort}/`,
            wsUrl: `ws://${formatHost(localHost)}:${localPort}/ws`,
          },
        }
      : {}),
    ...(panel
      ? {
          panel: {
            host: panelHost,
            port: panel.port,
            url: panel.url,
          },
        }
      : {}),
  }
}

function advertisedHost(configured: string, bindHost: string): string {
  if (configured === '0.0.0.0' || configured === '::' || configured === '[::]') {
    return bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost
  }
  return configured
}

function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

function isContainerized(): boolean {
  return readBooleanEnv('CLARA_SERVER_CONTAINER')
}

function log(message: string, detail?: unknown): void {
  panelLog.add(message, detail)
  if (detail !== undefined) {
    const text = detail instanceof Error ? detail.message : String(detail)
    console.error(`[clara] ${message}: ${text}`)
    return
  }
  console.log(`[clara] ${message}`)
}

function parsePanelPort(value: string | undefined, hint?: number): number {
  const configured = value?.trim()
  if (configured !== undefined && configured !== '') {
    const port = Number.parseInt(configured, 10)
    // Zero lets the OS choose; the actual URL is published in the runtime file.
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error(`Invalid panel port: ${value}`)
    }
    return port
  }
  if (Number.isInteger(hint) && hint !== undefined && hint > 0 && hint <= 65_535) return hint
  return DEFAULT_PANEL_PORT
}

function readBooleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}
