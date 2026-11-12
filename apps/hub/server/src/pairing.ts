import qrcode from 'qrcode-terminal'
import {
  PAIRING_CODE_PREFIX,
  PROTOCOL_VERSION,
  buildPairingUrl,
  encodePairingCode,
  type PairingPayload,
} from '@clara/shared-types'
import { localWebPort, type ServerConfig } from './config.ts'
import type { DeviceStore } from './store/devices.ts'

export type PairingOptions = {
  /**
   * The command asked for a local-only code with --no-relay. The relay is
   * already absent from the config in that case, but the printed guidance
   * differs.
   */
  noRelay?: boolean
}

export async function createPairingPayload(
  config: ServerConfig,
  devices: DeviceStore
): Promise<PairingPayload> {
  const relay = config.relay
  const wsUrl = relay
    ? relayWsUrl(relay.url, relay.room)
    : `ws://${config.local.host}:${config.local.port}/ws`
  const token = await devices.createPairingToken()

  return {
    v: PROTOCOL_VERSION,
    wsUrl,
    room: relay?.room ?? 'local',
    clientToken: relay?.clientToken ?? 'local',
    enrollId: token.id,
    enrollToken: token.token,
    fingerprint: token.fingerprint,
    expiresAt: token.expiresAt,
  }
}

/**
 * The link a pairing code opens. By default it uses the configured Web URL,
 * even for a local code. `--no-relay` switches to the local web app so the
 * link and the hub's ws:// listener stay on the same machine, unless the
 * configured base is already loopback (for example the Vite dev server).
 */
export function pairingLinkBase(
  pairingBaseUrl: string,
  localHost: string,
  options: { noRelay?: boolean; webPort?: number } = {}
): string {
  if (!options.noRelay) return pairingBaseUrl
  if (isLoopbackUrl(pairingBaseUrl)) return pairingBaseUrl
  const host = localHost.startsWith('[')
    ? localHost
    : localHost.includes(':')
      ? `[${localHost}]`
      : localHost
  return `http://${host}:${options.webPort ?? localWebPort()}`
}

export async function printPairing(
  config: ServerConfig,
  devices: DeviceStore,
  withQr = true,
  options: PairingOptions = {}
): Promise<PairingPayload> {
  const payload = await createPairingPayload(config, devices)
  const url = buildPairingUrl(
    pairingLinkBase(config.pairingBaseUrl, config.local.host, { noRelay: options.noRelay }),
    payload
  )
  const code = `${PAIRING_CODE_PREFIX}${encodePairingCode(payload)}`
  const minutes = Math.max(1, Math.round((payload.expiresAt - Date.now()) / 60_000))

  console.log('')
  console.log('Clara pairing')
  console.log(`  Open:        ${url}`)
  console.log(`  Code:        ${code}`)
  console.log(`  Room:        ${payload.room}`)
  console.log(`  Fingerprint: ${payload.fingerprint}`)
  console.log(`  Expires:     in ${minutes} minute(s), one device`)
  if (!config.relay) {
    console.log(
      options.noRelay
        ? '  Relay:       bypassed by --no-relay; this code only works on the local machine.'
        : '  Relay:       not configured; this code only works on the local machine.'
    )
    if (!options.noRelay && !isLoopbackUrl(config.pairingBaseUrl)) {
      console.log('               Use --no-relay to open the local web app instead.')
    }
  }
  console.log('')
  if (withQr) qrcode.generate(url, { small: true })

  return payload
}

function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

export function relayWsUrl(value: string, room: string): string {
  const url = new URL(value)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/room/${encodeURIComponent(room)}`
  url.search = ''
  url.hash = ''
  return url.toString()
}
