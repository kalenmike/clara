import qrcode from 'qrcode-terminal'
import {
  ENROLLMENT_GRANT_TTL_SECONDS,
  PAIRING_CODE_PREFIX,
  PROTOCOL_VERSION,
  buildPairingUrl,
  createRelayGrant,
  encodePairingCode,
  type PairingPayload,
} from '@clara/shared-types'
import { localWebPort, type RelayConfig, type ServerConfig } from './config.ts'
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
  devices: DeviceStore,
  options: PairingOptions = {}
): Promise<PairingPayload> {
  const relay = options.noRelay ? undefined : usableRelay(config.relay)
  const wsUrl = relay
    ? relayWsUrl(relay.url, relay.room)
    : `ws://${config.local.host}:${config.local.port}/ws`
  const token = await devices.createPairingToken()
  // The relay no longer accepts a shared client token. A relay pairing carries
  // a one-time grant scoped to this enrollment; a local pairing needs none.
  const grant = relay
    ? await createRelayGrant({
        room: relay.room,
        id: token.id,
        agentToken: relay.agentToken,
        ttlSeconds: ENROLLMENT_GRANT_TTL_SECONDS,
      })
    : undefined

  return {
    v: PROTOCOL_VERSION,
    wsUrl,
    room: relay?.room ?? 'local',
    enrollId: token.id,
    enrollToken: token.token,
    ...(grant ? { grant: grant.grant } : {}),
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
  const payload = await createPairingPayload(config, devices, options)
  const relayIncomplete = Boolean(config.relay && !usableRelay(config.relay))
  const useLocalLink = Boolean(options.noRelay || relayIncomplete)
  const url = buildPairingUrl(
    pairingLinkBase(config.pairingBaseUrl, config.local.host, { noRelay: useLocalLink }),
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
  } else if (!options.noRelay && !usableRelay(config.relay)) {
    console.log(
      '  Relay:       the hub token is missing; this code is local-only. Save it in the hub panel Relay card.'
    )
  }
  console.log('')
  if (withQr) printPairingQr(url)

  return payload
}

/**
 * A wrapped QR does not scan, so only print one the terminal can show whole.
 * A relay code carries its enrollment grant and is the widest Clara produces;
 * on a narrow terminal the link and code above are the usable output.
 */
function printPairingQr(url: string): void {
  qrcode.generate(url, { small: true }, (rendered) => {
    const columns = terminalColumns()
    const width = Math.max(...rendered.split('\n').map((line) => line.length))
    if (columns !== null && width > columns) {
      console.log(
        `  QR:          skipped; it needs ${width} columns of this ${columns}-column terminal.`
      )
      console.log('               Widen the terminal, open the link above, or paste the code.')
      return
    }
    console.log(rendered)
  })
}

/** The terminal width, or null when the output is redirected. */
function terminalColumns(): number | null {
  const configured = Number(process.env.COLUMNS)
  const columns =
    Number.isFinite(configured) && configured > 0 ? configured : process.stdout.columns
  return typeof columns === 'number' && Number.isFinite(columns) && columns > 0
    ? Math.floor(columns)
    : null
}

function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

function usableRelay(relay: RelayConfig | undefined): RelayConfig | undefined {
  return relay?.url && relay.agentToken ? relay : undefined
}

export function relayWsUrl(value: string, room: string): string {
  const url = new URL(value)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/room/${encodeURIComponent(room)}`
  url.search = ''
  url.hash = ''
  return url.toString()
}
