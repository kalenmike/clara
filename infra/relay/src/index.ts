import {
  PROTOCOL_VERSION,
  RELAY_AUTH_PREFIX,
  RELAY_ROLE_PREFIX,
  RELAY_SUBPROTOCOL,
  type RelayRole,
} from '@clara/shared-types'
import type { Env } from './env.ts'
import { RELAY_VERSION } from './room.ts'

export { RelayRoom } from './room.ts'

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({ ok: true, protocol: PROTOCOL_VERSION, relay: RELAY_VERSION })
    }

    const match = /^\/room\/([^/]+)$/.exec(url.pathname)
    if (!match) return json({ error: 'not found' }, 404)

    let roomId: string
    try {
      roomId = decodeURIComponent(match[1])
    } catch {
      // Malformed percent escapes must not surface as an internal error.
      return json({ error: 'invalid room' }, 400)
    }
    if (!ROOM_PATTERN.test(roomId)) return json({ error: 'invalid room' }, 400)

    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405)
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'expected a WebSocket upgrade' }, 426)
    }

    const auth = parseProtocols(request.headers.get('sec-websocket-protocol'))
    if (!auth || auth.version !== RELAY_SUBPROTOCOL) {
      return json({ error: 'unsupported protocol' }, 400)
    }
    if (!(await isAuthorized(auth.role, auth.token, env))) {
      return json({ error: 'unauthorized' }, 401)
    }

    const headers = new Headers(request.headers)
    headers.delete('x-clara-role')
    headers.set('x-clara-role', auth.role)
    const forwardedProtocols = forwardedProtocolHeader(headers.get('sec-websocket-protocol'))
    if (forwardedProtocols) headers.set('sec-websocket-protocol', forwardedProtocols)
    else headers.delete('sec-websocket-protocol')

    const stub = env.RELAY_ROOMS.get(env.RELAY_ROOMS.idFromName(roomId))
    return stub.fetch(new Request(request.url, { method: 'GET', headers }))
  },
} satisfies ExportedHandler<Env>

type ParsedProtocols = {
  version: string
  role: RelayRole
  token: string
}

function parseProtocols(header: string | null): ParsedProtocols | null {
  if (!header) return null
  const protocols = header.split(',').map((value) => value.trim())
  const version = protocols.find((value) => value === RELAY_SUBPROTOCOL)
  const role = protocols
    .find((value) => value.startsWith(RELAY_ROLE_PREFIX))
    ?.slice(RELAY_ROLE_PREFIX.length)
  const token = protocols
    .find((value) => value.startsWith(RELAY_AUTH_PREFIX))
    ?.slice(RELAY_AUTH_PREFIX.length)
  if (!version || (role !== 'agent' && role !== 'client')) return null
  // A missing credential is an authentication failure, not an unsupported
  // protocol; keep the empty value so isAuthorized fails closed.
  return { version, role, token: token ?? '' }
}

async function isAuthorized(role: RelayRole, token: string, env: Env): Promise<boolean> {
  const expected = role === 'agent' ? env.CLARA_AGENT_TOKEN : env.CLARA_CLIENT_TOKEN
  if (!expected || !token) return false
  return constantTimeEqual(token, expected)
}

/**
 * Compare secrets without an observable length check. Both candidates are
 * hashed to 32 bytes first, so a wrong-length token costs the same as a wrong
 * value and the compare loop never exits early.
 */
async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])
  const a = new Uint8Array(leftDigest)
  const b = new Uint8Array(rightDigest)
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

/**
 * Clara subprotocols authenticate the browser against the Worker. The Durable
 * Object only needs the role stamp, so keep the credential out of the
 * forwarded request. When the header carries nothing but Clara values it is
 * dropped entirely; a non-Clara protocol is forwarded unchanged.
 */
export function forwardedProtocolHeader(header: string | null): string | null {
  if (!header) return null
  const protocols = header
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith(RELAY_AUTH_PREFIX))
  if (protocols.length === 0) return null
  const claraOnly = protocols.every(
    (value) => value === RELAY_SUBPROTOCOL || value.startsWith(RELAY_ROLE_PREFIX)
  )
  return claraOnly ? null : protocols.join(', ')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
