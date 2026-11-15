import type { PanelApiTransport } from './panel-api.ts'

/**
 * The prefix the hub bridge mounts the panel API on for a browser that reaches
 * the hub over its WebSocket transport instead of the panel origin.
 */
export const PANEL_TUNNEL_BASE_PATH = '/v1/hub-panel'

const PANEL_API_PREFIX = '/panel/api/v1'

/**
 * The panel API paths keep their `/panel/api/v1` names on the server, so the
 * tunnel strips that prefix and mounts the remainder under the hub bridge.
 * Query strings are part of the path and stay intact.
 */
export type PanelTunnelFetch = (path: string, init: RequestInit) => Promise<Response>

export type TunnelPanelTransportOptions = {
  /** A path-based fetch supplied by the web route, for example over the hub WebSocket. */
  fetch: PanelTunnelFetch
  /** Hub bridge mount point; defaults to `/v1/hub-panel`. */
  basePath?: string
  /** Reads the session token from the panel session store, when one exists. */
  getToken?: () => string | null | undefined
}

/** Rewrite one panel API path for the hub bridge, keeping its query string. */
export function tunnelPanelPath(path: string, basePath: string = PANEL_TUNNEL_BASE_PATH): string {
  const base = basePath.replace(/\/+$/, '') || PANEL_TUNNEL_BASE_PATH
  if (path === PANEL_API_PREFIX) return base
  if (!path.startsWith(`${PANEL_API_PREFIX}/`)) {
    throw new Error(`A tunneled panel request must start with ${PANEL_API_PREFIX}.`)
  }
  return `${base}${path.slice(PANEL_API_PREFIX.length)}`
}

/**
 * Build the panel API transport for the `/hub` route. It keeps every header the
 * panel sets, including `x-clara-panel` and the JSON headers, and adds the
 * session token as a bearer credential when one exists. The server-served panel
 * never configures this transport and keeps its same-origin cookie.
 */
export function createTunnelPanelTransport({
  fetch: tunnelFetch,
  basePath = PANEL_TUNNEL_BASE_PATH,
  getToken,
}: TunnelPanelTransportOptions): PanelApiTransport {
  return async (request) => {
    const token = getToken?.()
    const headers: Record<string, string> = { ...request.headers }
    if (token) headers.authorization = `Bearer ${token}`

    return tunnelFetch(tunnelPanelPath(request.path, basePath), {
      method: request.method,
      headers,
      body: request.body,
      credentials: request.credentials,
      cache: request.cache,
      signal: request.signal,
    })
  }
}
