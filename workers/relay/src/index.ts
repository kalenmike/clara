import {
  PROTOCOL_VERSION,
  RELAY_AUTH_PREFIX,
  RELAY_ROLE_PREFIX,
  RELAY_SUBPROTOCOL,
  type RelayRole,
} from '@clara/shared-types'
import type { Env } from './env.ts'

export { RelayRoom } from './room.ts'

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({ ok: true, protocol: PROTOCOL_VERSION })
    }

    const match = /^\/room\/([^/]+)$/.exec(url.pathname)
    if (!match) return json({ error: 'not found' }, 404)

    const roomId = decodeURIComponent(match[1])
    if (!ROOM_PATTERN.test(roomId)) return json({ error: 'invalid room' }, 400)

    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405)
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'expected a WebSocket upgrade' }, 426)
    }

    const auth = parseProtocols(request.headers.get('sec-websocket-protocol'))
    if (!auth || auth.version !== RELAY_SUBPROTOCOL) {
      return json({ error: 'unsupported protocol' }, 400)
    }
    if (!isAuthorized(auth.role, auth.token, env)) {
      return json({ error: 'unauthorized' }, 401)
    }

    const headers = new Headers(request.headers)
    headers.delete('x-clara-role')
    headers.set('x-clara-role', auth.role)

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
  if (!version || (role !== 'agent' && role !== 'client') || !token) return null
  return { version, role, token }
}

function isAuthorized(role: RelayRole, token: string, env: Env): boolean {
  const expected = role === 'agent' ? env.CLARA_AGENT_TOKEN : env.CLARA_CLIENT_TOKEN
  if (!expected || !token) return false
  return timingSafeEqual(token, expected)
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
