import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTOCOL_VERSION } from '@clara/shared-types'
import { loadAdminPaths, loadConfig, validateRelayConfig } from './config.ts'
import { loadCloudflareDeploymentFeature } from './features/cloudflare-deployment/loader.ts'
import { HarnessManager } from './harness/manager.ts'
import { HarnessMetadataStore } from './harness/metadata.ts'
import { HarnessStore } from './harness/store.ts'
import { ProjectStore } from './projects/store.ts'
import { PanelAuth } from './panel/auth.ts'
import { PanelLog } from './panel/log.ts'
import { PanelRuntime } from './panel/runtime.ts'
import { startPanelServer, type PanelServer } from './panel/server.ts'
import { readSetupToken, readSetupTokenFromEnv } from './panel/setup-token.ts'
import { printPairing } from './pairing.ts'
import { PushService } from './push/service.ts'
import { clearPushSubscriptions, PushSubscriptionStore } from './push/store.ts'
import { loadVapidDetails } from './push/vapid.ts'
import { RuntimeController } from './runtime/controller.ts'
import { ClientStorageStore } from './store/client-storage.ts'
import { closeDatabase, openDatabase, schemaVersion } from './store/database.ts'
import { DeviceStore } from './store/devices.ts'
import { PanelUserStore } from './store/panel-users.ts'
import { readApiToken } from './api/token.ts'
import { readSecretKey } from './store/secret-key.ts'
import { SettingsStore } from './store/settings.ts'
import { SERVER_VERSION } from './version.ts'

const panelLog = new PanelLog()
const DEFAULT_PANEL_PORT = 8790

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0] ?? 'serve'

  if (command === 'admin') {
    await runAdmin(args.slice(1))
    return
  }

  if (command !== 'serve' && command !== 'pair') {
    console.error(`Unknown command: ${command}`)
    console.error('Usage: clara-server [serve|pair|admin] [--no-panel]')
    console.error('       clara-server pair [--no-relay] [--no-qr] [--revoke-all|--revoke <id>]')
    console.error('       clara-server admin reset|setup-token')
    process.exitCode = 2
    return
  }

  // A local-only code is a pairing command option; serving must keep its relay
  // config so the outbound transport still starts.
  const noRelay = command === 'pair' && args.includes('--no-relay')
  const config = loadConfig({ noRelay, allowMissingRelayTokens: true })

  const database = openDatabase(config.dbPath)
  const secretKey = await readSecretKey(config.configDir)
  const cloudflare = await loadCloudflareDeploymentFeature({
    config,
    secretKey,
    log,
  })
  if (!noRelay) await cloudflare?.applyStoredRelay()
  validateRelayConfig(config)
  const devices = new DeviceStore({
    db: database,
    key: secretKey.key,
    keyVersion: secretKey.version,
  })

  if (command === 'pair') {
    try {
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
      return
    } finally {
      closeDatabase(database)
    }
  }

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
  if (panelEnabled) {
    try {
      const setup = auth.ensureSetupToken()
      if (setup?.fromEnv) log('panel setup token provided by the environment')
      else if (setup?.path) {
        log(`panel setup required; read the one-time token at ${setup.path}`)
        log('print it with: clara-server admin setup-token')
      }
    } catch (cause) {
      log('panel setup token unavailable; run `clara-server admin reset`', cause)
    }
  }

  const opencodeVersion =
    initial.stopped || !initial.features.opencode || !harness.configured
      ? undefined
      : await harness.probe(3_000).then((probe) => (probe.ok ? probe.version : undefined))
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
    log(`push ready (${push.count} device(s))`)
  } catch (cause) {
    pushError = cause instanceof Error ? cause.message : String(cause)
    log('push disabled', cause)
  }

  const info = {
    version: SERVER_VERSION,
    protocol: PROTOCOL_VERSION,
    opencodeVersion,
    room: config.relay?.room,
    pushPublicKey: push?.publicKey,
    orchestration: false,
  }

  const controller = new RuntimeController({
    config,
    harness,
    info,
    settings,
    sync: clientStorage,
    push,
    pushError,
    devices,
    startedAt,
    apiToken,
    log,
  })

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
      log(`harness ${harness.active?.label ?? 'harness'} answered with ${opencodeVersion}`)
    } else if (initial.features.opencode) {
      log('the configured harness is not answering')
    }
  }

  let panel: PanelServer | undefined
  if (panelEnabled) {
    const runtime = new PanelRuntime({
      config,
      harness,
      localAgent: controller.agent,
      relayAgent: () => controller.relay,
      relayClient: () => controller.relayTransport,
      localConnections: () => controller.localConnections,
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
    const assetsDir = join(dirname(fileURLToPath(import.meta.url)), 'panel')
    try {
      panel = await startPanelServer({
        source: runtime,
        controls: controller,
        feature: cloudflare?.panel,
        auth,
        host: process.env.CLARA_PANEL_BIND_HOST?.trim() || '127.0.0.1',
        allowRemote: readBooleanEnv('CLARA_PANEL_ALLOW_REMOTE'),
        port: parsePanelPort(process.env.CLARA_PANEL_PORT),
        assetsDir,
        log,
      })
      log(`panel at ${panel.url}`)
    } catch (cause) {
      log('panel unavailable', cause)
    }
  }

  log(`database at ${config.dbPath}`)
  log(`pairing config: ${config.configPath}`)
  log('print a pairing code with: clara-server pair')
  if (args.includes('--pair') || args.includes('--qr')) {
    await printPairing(config, devices, true, { noRelay })
  }

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    log('shutting down')
    await controller.close()
    cloudflare?.close()
    await panel?.close()
    closeDatabase(database)
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.on('unhandledRejection', (cause) => log('unhandled rejection', cause))
}

async function runAdmin(args: string[]): Promise<void> {
  const action = args[0]
  const paths = loadAdminPaths()
  if (action === 'setup-token') {
    const token = readSetupTokenFromEnv() ?? readSetupToken(paths.configDir)
    if (!token) {
      console.error('No setup token is available. Run `clara-server admin reset` first.')
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

function log(message: string, detail?: unknown): void {
  panelLog.add(message, detail)
  if (detail !== undefined) {
    const text = detail instanceof Error ? detail.message : String(detail)
    console.error(`[clara] ${message}: ${text}`)
    return
  }
  console.log(`[clara] ${message}`)
}

function parsePanelPort(value: string | undefined): number {
  const port = Number.parseInt(value?.trim() || String(DEFAULT_PANEL_PORT), 10)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid panel port: ${value}`)
  }
  return port
}

function readBooleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

void main().catch((cause) => {
  log('fatal', cause)
  process.exit(1)
})
