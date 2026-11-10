import { OpenCode } from '@opencode/client'
import type { ClaraAction } from '@clara/shared-types'
import {
  createRelayTransport,
  type PushStatusState,
  type RelayTransportStatus,
  type SyncRequestAction,
  type SyncResponse,
} from '@/lib/transport/relay'

export type ConnectionConfig = {
  /** Full WebSocket URL, including `/room/<id>` for a relay or `/ws` locally. */
  wsUrl: string
  room: string
  clientToken: string
  psk: string
  fingerprint: string
  /** Human-readable label shown in the UI. */
  label?: string
}

export type ClientControl = {
  send: (action: ClaraAction) => Promise<void>
  subscribePush: (listener: (state: PushStatusState) => void) => () => void
  requestSync: (action: SyncRequestAction) => Promise<SyncResponse>
}

export type ClientHandle = {
  client: OpenCodeClient
  close: () => void
  control: ClientControl
  subscribeStatus: (listener: (status: RelayTransportStatus) => void) => () => void
}

export type OpenCodeClient = ReturnType<typeof OpenCode.make>

export type ServerInfo = Awaited<ReturnType<OpenCodeClient['server']['info']>>

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export function connectionKey(config: ConnectionConfig): string {
  return `ws:${config.wsUrl}:${config.room}:${config.fingerprint}`
}

export function connectionUrl(config: ConnectionConfig | null): string {
  if (!config) return 'not connected'
  return `${config.wsUrl} (${config.room})`
}

/**
 * VITE_CLARA_WS_URL is the deployment switch for relay rooms: when set it
 * supplies the relay endpoint and the pairing payload supplies the room and
 * E2EE key. When unset, the pairing payload's own URL is used.
 *
 * A `local` room means the home agent has no relay configured, so the pairing
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
    psk: config.psk,
    fingerprint: config.fingerprint,
  })

  return {
    client: OpenCode.make({
      baseUrl: 'http://clara.relay',
      fetch: transport.fetch,
    }),
    close: () => transport.close(),
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
    return 'Could not reach the Clara server. Check that the home agent is running and its endpoint is reachable.'
  }
  if (error instanceof Error) return error.message
  return 'Unknown connection error.'
}
