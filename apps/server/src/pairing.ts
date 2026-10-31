import qrcode from 'qrcode-terminal'
import { fingerprintPsk } from '@clara/crypto'
import {
  PAIRING_CODE_PREFIX,
  PROTOCOL_VERSION,
  buildPairingUrl,
  encodePairingCode,
  type PairingPayload,
} from '@clara/shared-types'
import type { ServerConfig } from './config.ts'

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

export async function printPairing(config: ServerConfig, withQr = true): Promise<PairingPayload> {
  const payload = await createPairingPayload(config)
  const url = buildPairingUrl(config.pairingBaseUrl, payload)
  const code = `${PAIRING_CODE_PREFIX}${encodePairingCode(payload)}`

  console.log('')
  console.log('Clara pairing')
  console.log(`  Open:        ${url}`)
  console.log(`  Code:        ${code}`)
  console.log(`  Fingerprint: ${payload.fingerprint}`)
  if (!config.relay) {
    console.log('  Relay:       not configured; this code only works on the local machine.')
  }
  console.log('')
  if (withQr) qrcode.generate(url, { small: true })

  return payload
}

export function relayWsUrl(value: string, room: string): string {
  const url = new URL(value)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/room/${encodeURIComponent(room)}`
  url.search = ''
  url.hash = ''
  return url.toString()
}
