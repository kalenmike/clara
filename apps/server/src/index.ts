import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fingerprintPsk } from '@clara/crypto'
import { PROTOCOL_VERSION } from '@clara/shared-types'
import { LedgerReader } from './ledger/reader.ts'
import { LedgerAlertStore } from './ledger/store.ts'
import { loadConfig } from './config.ts'
import { OpenCodeClient } from './opencode.ts'
import { printPairing } from './pairing.ts'
import { PanelLog } from './panel/log.ts'
import { PanelRuntime } from './panel/runtime.ts'
import { startPanelServer, type PanelServer } from './panel/server.ts'
import { PushService } from './push/service.ts'
import { clearPushSubscriptions, PushSubscriptionStore } from './push/store.ts'
import { loadVapidDetails } from './push/vapid.ts'
import { RuntimeController } from './runtime/controller.ts'
import { ClientStorageStore } from './store/client-storage.ts'
import { closeDatabase, openDatabase, schemaVersion } from './store/database.ts'
import { SettingsStore } from './store/settings.ts'
import { SERVER_VERSION } from './version.ts'

const panelLog = new PanelLog()
const DEFAULT_PANEL_PORT = 8790

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0] ?? 'serve'
  const rotate = args.includes('--rotate')

  if (command !== 'serve' && command !== 'pair') {
    console.error(`Unknown command: ${command}`)
    console.error('Usage: clara-server [serve|pair] [--rotate] [--no-panel]')
    console.error('       clara-server pair [--local] [--no-qr]')
    process.exitCode = 2
    return
  }

  // A local-only code is a pairing command option; serving must keep its relay
  // config so the outbound transport still starts.
  const localPairing = command === 'pair' && args.includes('--local')
  const config = loadConfig({ rotate, local: localPairing })

  if (rotate) {
    const removed = clearPushSubscriptions(join(config.configDir, 'subscriptions.json'))
    log(`pairing key rotated; cleared ${removed} push subscription(s)`)
  }

  if (command === 'pair') {
    await printPairing(config, !args.includes('--no-qr'), { local: localPairing })
    return
  }

  const database = openDatabase(config.dbPath)
  const settings = new SettingsStore(database)
  const clientStorage = new ClientStorageStore(database)
  const ledger = new LedgerReader(config.ledgerDbPath, log)
  const ledgerStore = new LedgerAlertStore(database)
  const initial = settings.get()

  const openCode = new OpenCodeClient(config.opencode.url, config.opencode.password)
  const opencodeVersion =
    initial.stopped || !initial.features.opencode ? undefined : await openCode.probeVersion()
  const startedAt = Date.now() - Math.round(process.uptime() * 1000)
  const fingerprint = await fingerprintPsk(config.psk).catch(() => undefined)

  let push: PushService | undefined
  let pushError: string | undefined
  try {
    const vapid = loadVapidDetails(config.configDir, config.pairingBaseUrl)
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
    management: initial.management,
  }

  const controller = new RuntimeController({
    config,
    openCode,
    info,
    settings,
    sync: clientStorage,
    push,
    pushError,
    ledger,
    ledgerStore,
    log,
  })

  await controller.start()

  if (!initial.stopped) {
    if (opencodeVersion) log(`OpenCode ${opencodeVersion} at ${config.opencode.url}`)
    else if (initial.features.opencode) log(`OpenCode is not answering at ${config.opencode.url}`)
  }

  let panel: PanelServer | undefined
  const panelEnabled = !args.includes('--no-panel') && process.env.CLARA_PANEL_DISABLED !== '1'
  if (panelEnabled) {
    const runtime = new PanelRuntime({
      config,
      openCode,
      localAgent: controller.agent,
      relayAgent: controller.relay,
      relayClient: controller.relayTransport,
      localConnections: () => controller.localConnections,
      traffic: controller.traffic,
      push,
      pushError,
      ledgerPath: config.ledgerDbPath,
      fingerprint,
      startedAt,
      controls: () => controller.controls(),
      probeEnabled: () => controller.canProxy(),
      database: {
        path: config.dbPath,
        schemaVersion: schemaVersion(database),
        sync: () => clientStorage.stats(),
      },
      log: panelLog,
    })
    const assetsDir =
      process.env.CLARA_PANEL_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'panel')
    try {
      panel = await startPanelServer({
        source: runtime,
        controls: controller,
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
    await printPairing(config, true, { local: localPairing })
  }

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    log('shutting down')
    await controller.close()
    await panel?.close()
    closeDatabase(database)
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.on('unhandledRejection', (cause) => log('unhandled rejection', cause))
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

void main().catch((cause) => {
  log('fatal', cause)
  process.exit(1)
})
