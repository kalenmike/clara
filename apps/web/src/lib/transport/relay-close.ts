/**
 * WebSocket close reasons and relay reachability.
 *
 * A browser cannot read the HTTP status of a refused upgrade, so a relay that
 * refuses a grant and a relay that cannot be reached look alike at the socket.
 * The transport probes the relay's health endpoint to separate the two: a
 * reachable relay that still refuses the upgrade has a dead grant and must not
 * be retried forever.
 */

const MAX_CLOSE_REASON_BYTES = 120
const HEALTH_TIMEOUT_MS = 3_000

export const LOCAL_ONLY_MESSAGE =
  'This pairing code is local-only. Configure the relay on the hub, then pair again.'
export const REFUSED_MESSAGE =
  'The relay refused the connection. Check the room URL and the relay configuration.'
export const RELAY_GRANT_REJECTED_MESSAGE =
  "The relay rejected this device's grant. Pair this device again from the hub panel."

/**
 * A WebSocket close reason is capped at 123 UTF-8 bytes and an overlong reason
 * throws, so carry the message only while it fits.
 */
export function closeReason(message: string): string {
  const bytes = new TextEncoder().encode(message)
  if (bytes.byteLength <= MAX_CLOSE_REASON_BYTES) return message
  return new TextDecoder().decode(bytes.slice(0, MAX_CLOSE_REASON_BYTES))
}

/**
 * A refused WebSocket upgrade (Worker 404/401, or a mixed-content block for a
 * `ws://` endpoint on an HTTPS page) closes without a reason, so turn the bare
 * code into something actionable.
 */
export function describeClose(event: CloseEvent, wsUrl: string, wasOpen: boolean): string {
  if (event.reason) return event.reason
  if (event.code === 1006 || event.code === 1005) {
    if (wasOpen) return 'The connection to the relay dropped. Reconnecting.'
    return refusedReason(wsUrl)
  }
  return `The relay connection closed (code ${event.code}).`
}

export function refusedReason(wsUrl: string): string {
  return isBlockedLocalEndpoint(wsUrl) ? LOCAL_ONLY_MESSAGE : REFUSED_MESSAGE
}

function isBlockedLocalEndpoint(wsUrl: string): boolean {
  if (!wsUrl.startsWith('ws://')) return false
  return typeof window !== 'undefined' && window.location?.protocol === 'https:'
}

/** The relay's unauthenticated health endpoint, derived from its room URL. */
export function relayHealthUrl(wsUrl: string): string {
  const url = new URL(wsUrl)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/health'
  url.search = ''
  url.hash = ''
  return url.toString()
}

/**
 * True when the relay answers its health endpoint. A refused upgrade against a
 * reachable relay is a credential failure; an unreachable one is transient.
 * The Worker serves `/health` with `access-control-allow-origin: *`, so this
 * probe works from the web client's origin even when the relay is remote.
 */
export async function relayReachable(wsUrl: string): Promise<boolean> {
  try {
    const response = await globalThis.fetch(relayHealthUrl(wsUrl), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}
