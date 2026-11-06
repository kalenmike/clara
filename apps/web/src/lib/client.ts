import { OpenCode } from '@opencode/client'
import type { ClaraAction, PipelineCatalog } from '@clara/shared-types'
import {
  createRelayTransport,
  type PushStatusState,
  type RelayTransportStatus,
  type SyncRequestAction,
  type SyncResponse,
} from '@/lib/transport/relay'

export type DirectConnectionConfig = {
  mode?: 'direct'
  /** Base URL without a trailing slash. Local proxy mode uses `<origin>/oc`. */
  baseUrl: string
  /** Password for the `opencode` basic-auth user. Omitted for the dev proxy. */
  password?: string
  /** Human-readable label shown in the UI. */
  label?: string
  /** Persist the password in local storage instead of session storage. */
  remember?: boolean
}

export type RelayConnectionConfig = {
  mode: 'relay'
  /** Full WebSocket URL, including `/room/<id>` for a relay or `/ws` locally. */
  wsUrl: string
  room: string
  clientToken: string
  psk: string
  fingerprint: string
  label?: string
  remember?: boolean
}

export type ConnectionConfig = DirectConnectionConfig | RelayConnectionConfig

/**
 * Re-exported here because the Settings composition point may read the
 * build-time inclusion switch without importing Clara feature modules.
 */
export { CLARA_FEATURE_INCLUDED } from '@/features/clara/flag'

export type ClientControl = {
  send: (action: ClaraAction) => Promise<void>
  subscribePush: (listener: (state: PushStatusState) => void) => () => void
  requestSync: (action: SyncRequestAction) => Promise<SyncResponse>
  listPipelines: () => Promise<PipelineCatalog>
}

export type ClientHandle = {
  client: OpenCodeClient
  close: () => void
  control?: ClientControl
  subscribeStatus?: (listener: (status: RelayTransportStatus) => void) => () => void
  status?: () => RelayTransportStatus
}

export type OpenCodeClient = ReturnType<typeof OpenCode.make>

export type ServerInfo = Awaited<ReturnType<OpenCodeClient['server']['info']>>

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export function isRelayConfig(config: ConnectionConfig): config is RelayConnectionConfig {
  return config.mode === 'relay'
}

export function connectionKey(config: ConnectionConfig): string {
  return isRelayConfig(config)
    ? `relay:${config.wsUrl}:${config.room}:${config.fingerprint}`
    : `direct:${config.baseUrl}`
}

export function connectionUrl(config: ConnectionConfig | null): string {
  if (!config) return 'not connected'
  return isRelayConfig(config) ? `${config.wsUrl} (${config.room})` : config.baseUrl
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

export function basicAuth(password: string) {
  const bytes = new TextEncoder().encode(`opencode:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

export function createClient(config: ConnectionConfig): ClientHandle {
  if (isRelayConfig(config)) {
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
        listPipelines: () => transport.requestPipelines(),
      },
      subscribeStatus: (listener) => transport.subscribe(listener),
      status: () => transport.status(),
    }
  }

  return {
    client: OpenCode.make({
      baseUrl: config.baseUrl.replace(/\/+$/, ''),
      headers: config.password ? { authorization: basicAuth(config.password) } : undefined,
    }),
    close: () => {},
  }
}

export async function fetchServerInfo(
  config: DirectConnectionConfig,
  signal?: AbortSignal
): Promise<ServerInfo> {
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/api/info`, {
    headers: config.password ? { authorization: basicAuth(config.password) } : undefined,
    signal,
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication failed. Check the server password.')
    }
    throw new Error(`Server responded with ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as ServerInfo
}

/** The Vite dev server proxies `/oc` to the local OpenCode service with auth. */
export function localProxyConfig(): DirectConnectionConfig {
  return {
    mode: 'direct',
    baseUrl: `${window.location.origin}/oc`,
    label: 'Local OpenCode service',
  }
}

export async function detectLocalService(): Promise<ServerInfo | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 2500)
  try {
    return await fetchServerInfo(localProxyConfig(), controller.signal)
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
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
    return 'Could not reach the server. Check the URL, CORS settings, and that OpenCode is running.'
  }
  if (error instanceof Error) return error.message
  return 'Unknown connection error.'
}
