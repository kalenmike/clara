import qrcode from 'qrcode-terminal'
import { fingerprintPsk } from '@clara/crypto'
import {
  PAIRING_CODE_PREFIX,
  PROTOCOL_VERSION,
  buildPairingUrl,
  encodePairingCode,
  type PairingPayload,
} from '@clara/shared-types'
import { localWebPort, type ServerConfig } from './config.ts'

export type PairingOptions = {
  /**
   * The command asked for a local-only code. The relay is already absent from
   * the config in that case, but the printed guidance differs.
   */
  local?: boolean
}

export async function createPairingPayload(config: ServerConfig): Promise<PairingPayload> {
  const relay = config.relay
  const wsUrl = relay
    ? relayWsUrl(relay.url, relay.room)
    : `ws://${config.local.host}:${config.local.port}/ws`

  return {
    v: PROTOCOL_VERSION,
    wsUrl,
    room: relay?.room ?? 'local',
    clientToken: relay?.clientToken ?? 'local',
    psk: config.psk,
    fingerprint: await fingerprintPsk(config.psk),
  }
}

/**
 * Local codes can only be used by a browser on the agent's host. Print them
 * against the local web app instead of a remote deployment URL, unless the
 * configured base is already loopback (for example the Vite dev server).
 */
export function pairingLinkBase(
  payload: Pick<PairingPayload, 'room'>,
  pairingBaseUrl: string,
  localHost: string,
  webPort = localWebPort()
): string {
  if (payload.room !== 'local' || isLoopbackUrl(pairingBaseUrl)) return pairingBaseUrl
  const host = localHost.startsWith('[')
    ? localHost
    : localHost.includes(':')
      ? `[${localHost}]`
      : localHost
  return `http://${host}:${webPort}`
}

export async function printPairing(
  config: ServerConfig,
  withQr = true,
  options: PairingOptions = {}
): Promise<PairingPayload> {
  const payload = await createPairingPayload(config)
  const url = buildPairingUrl(
    pairingLinkBase(payload, config.pairingBaseUrl, config.local.host),
    payload
  )
  const code = `${PAIRING_CODE_PREFIX}${encodePairingCode(payload)}`

  console.log('')
  console.log('Clara pairing')
  console.log(`  Open:        ${url}`)
  console.log(`  Code:        ${code}`)
  console.log(`  Room:        ${payload.room}`)
  console.log(`  Fingerprint: ${payload.fingerprint}`)
  if (!config.relay) {
    console.log(
      options.local
        ? '  Relay:       bypassed by --local; this code only works on the local machine.'
        : '  Relay:       not configured; this code only works on the local machine.'
    )
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
