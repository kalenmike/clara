import { createClaraClient, type ClaraClient } from '@clara/api-client'
import type { ClaraAction } from '@clara/shared-types'
import {
  createRelayTransport,
  type EnrolledDevice,
  type PushStatusState,
  type RelayTransportStatus,
  type SyncRequestAction,
  type SyncResponse,
} from '@/lib/transport/relay'

export type DeviceConnection = {
  kind: 'device'
  /** Full WebSocket URL, including `/room/<id>` for a relay or `/ws` locally. */
  wsUrl: string
  room: string
  clientToken: string
  deviceId: string
  key: CryptoKey
  fingerprint: string
  label: string
}

export type EnrollmentConnection = {
  kind: 'enroll'
  wsUrl: string
  room: string
  clientToken: string
  enrollId: string
  enrollToken: string
  expiresAt: number
  label: string
}

export type ConnectionConfig = DeviceConnection | EnrollmentConnection

/** Non-secret connection metadata for the settings and connect screens. */
export type ConnectionSummary = {
  wsUrl: string
  room: string
  label: string
  deviceId?: string
}

export type ClientControl = {
  send: (action: ClaraAction) => Promise<void>
  subscribePush: (listener: (state: PushStatusState) => void) => () => void
  requestSync: (action: SyncRequestAction) => Promise<SyncResponse>
}

export type ClientHandle = {
  client: ClaraClient
  close: () => void
  enroll: (label: string) => Promise<EnrolledDevice>
  control: ClientControl
  subscribeStatus: (listener: (status: RelayTransportStatus) => void) => () => void
}

export type { ClaraClient }

export type ServerInfo = Awaited<ReturnType<ClaraClient['server']['info']>>

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export function connectionKey(config: ConnectionSummary): string {
  return `ws:${config.wsUrl}:${config.room}:${config.deviceId ?? 'enroll'}`
}

export function connectionUrl(config: ConnectionSummary | null): string {
  if (!config) return 'not connected'
  return `${config.wsUrl} (${config.room})`
}

export function connectionSummary(config: ConnectionConfig): ConnectionSummary {
  return {
    wsUrl: config.wsUrl,
    room: config.room,
    label: config.label,
    ...(config.kind === 'device' ? { deviceId: config.deviceId } : {}),
  }
}

/**
 * VITE_CLARA_WS_URL is the deployment switch for relay rooms: when set it
 * supplies the relay endpoint and the pairing payload supplies the room. When
 * unset, the pairing payload's own URL is used.
 *
 * A `local` room means the hub has no relay configured, so the pairing
 * payload's URL is the only usable endpoint. Rewriting it to a relay base would
 * produce `<relay>/ws`, which the Worker does not route.
 */
export function resolveRelayWsUrl(wsUrl: string, room: string): string {
  if (room === 'local') return wsUrl

  const configured = import.meta.env.VITE_CLARA_WS_URL?.trim()
  if (!configured) return wsUrl

  const url = new URL(configured)
  if (!url.pathname.includes('/room/')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/room/${encodeURIComponent(room)}`
  }
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function createClient(config: ConnectionConfig): ClientHandle {
  const transport = createRelayTransport({
    wsUrl: config.wsUrl,
    clientToken: config.clientToken,
    credential:
      config.kind === 'device'
        ? { kind: 'device', deviceId: config.deviceId, key: config.key }
        : {
            kind: 'enroll',
            enrollId: config.enrollId,
            enrollToken: config.enrollToken,
            expiresAt: config.expiresAt,
          },
  })

  return {
    client: createClaraClient({
      baseUrl: 'http://clara.api',
      fetch: transport.fetch,
    }),
    close: () => transport.close(),
    enroll: (label) => transport.enroll(label),
    control: {
      send: (action) => transport.sendAction(action),
      subscribePush: (listener) => transport.subscribePush(listener),
      requestSync: (action) => transport.requestSync(action),
    },
    subscribeStatus: (listener) => transport.subscribe(listener),
  }
}

export function describeConnectionError(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return 'Timed out while contacting the server.'
  }
  if (error instanceof TypeError) {
    return 'Could not reach the Clara hub. Check that the hub service is running and its endpoint is reachable.'
  }
  if (error instanceof Error) return error.message
  return 'Unknown connection error.'
}
