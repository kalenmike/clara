import type { Context, Hono } from 'hono'
import type { ApiDependencies, ApiVariables, PanelEndpoint } from '../context.ts'

const TUNNEL_PREFIX = '/v1/hub-panel'
const PANEL_API_PREFIX = '/panel/api/v1'
const TUNNEL_HEADER = 'x-clara-panel-transport'
const PANEL_HEADER = 'x-clara-panel'
const MAX_BODY_BYTES = 8 * 1024

/** Only the loopback panel's own API is reachable; nothing else is tunneled. */
const FORWARD_HEADERS = [
  'accept',
  'content-type',
  'authorization',
  PANEL_HEADER,
  'user-agent',
] as const

const RESPONSE_HEADERS = ['content-type', 'cache-control', 'allow', 'retry-after'] as const

type TunnelContext = Context<{ Variables: ApiVariables }>

/**
 * Carries authenticated panel API calls from the hub's `/v1` API to the
 * loopback panel listener. The panel cookie belongs to the panel origin, so a
 * tunneled session travels as `Authorization: Bearer` and the panel marks its
 * response with `x-clara-panel-transport: tunnel`.
 */
export function registerPanelBridge(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  const handler = (c: TunnelContext) => forward(c, deps)
  app.all(TUNNEL_PREFIX, handler)
  app.all(`${TUNNEL_PREFIX}/*`, handler)
}

async function forward(c: TunnelContext, deps: ApiDependencies): Promise<Response> {
  const endpoint = deps.panel?.()
  if (!endpoint) return unavailable(c)

  const route = resolveRoute(c, endpoint)
  if (!route.ok) return route.response

  const payload = await readBody(c)
  if (!payload.ok) return payload.response

  // The Go offline control stays exclusive to the served panel. The web route
  // cannot reach it through the tunnel.
  if (c.req.method === 'POST' && route.decoded === '/agent' && stopsConnections(payload.body)) {
    return c.json(
      {
        error: {
          code: 'control_path',
          message: 'The Go offline control is not available over the hub tunnel',
        },
      },
      403
    )
  }

  let upstream: Response
  try {
    upstream = await fetch(route.target, {
      method: c.req.method,
      headers: forwardHeaders(c, route.authority),
      ...(payload.body === undefined ? {} : { body: payload.body }),
      redirect: 'manual',
      signal: c.req.raw.signal,
    })
  } catch (cause) {
    deps.log('panel tunnel request failed', cause)
    return unavailable(c)
  }

  const headers = new Headers()
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  // `set-cookie` is never copied: the tunneled client keeps a bearer token.
  return new Response(c.req.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  })
}

type Route =
  { ok: true; target: URL; decoded: string; authority: string } | { ok: false; response: Response }

function resolveRoute(c: TunnelContext, endpoint: PanelEndpoint): Route {
  const requestUrl = new URL(c.req.url)
  const rest = requestUrl.pathname.slice(TUNNEL_PREFIX.length)

  let decoded: string
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    return { ok: false, response: invalidPath(c) }
  }
  if (
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    decoded.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    return { ok: false, response: invalidPath(c) }
  }

  const authority = `${formatHost(endpoint.host)}:${endpoint.port}`
  const target = new URL(`http://${authority}${PANEL_API_PREFIX}${rest}`)
  target.search = requestUrl.search
  // Normalizing a hostile path must never leave the panel API surface.
  if (!target.pathname.startsWith('/panel/api/')) {
    return { ok: false, response: invalidPath(c) }
  }
  return { ok: true, target, decoded, authority }
}

type Body = { ok: true; body: ArrayBuffer | undefined } | { ok: false; response: Response }

async function readBody(c: TunnelContext): Promise<Body> {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return { ok: true, body: undefined }
  const body = await c.req.arrayBuffer()
  if (body.byteLength <= MAX_BODY_BYTES) return { ok: true, body }
  return {
    ok: false,
    response: c.json(
      {
        error: {
          code: 'body_too_large',
          message: `The request body may be at most ${MAX_BODY_BYTES} bytes`,
        },
      },
      413
    ),
  }
}

function forwardHeaders(c: TunnelContext, authority: string): Headers {
  const headers = new Headers()
  for (const name of FORWARD_HEADERS) {
    const value = c.req.header(name)
    if (value !== undefined) headers.set(name, value)
  }
  // The loopback URL supplies Host; the panel's Origin guard still needs the
  // panel's own origin, never the hub's. The tunnel marker is always replaced.
  headers.set('origin', `http://${authority}`)
  headers.set(TUNNEL_HEADER, 'tunnel')
  return headers
}

function stopsConnections(body: ArrayBuffer | undefined): boolean {
  if (!body) return false
  try {
    const value = JSON.parse(new TextDecoder().decode(body)) as unknown
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).stopped === true
    )
  } catch {
    return false
  }
}

function unavailable(c: TunnelContext): Response {
  return c.json(
    { error: { code: 'panel_unavailable', message: 'The hub panel is not running' } },
    503
  )
}

function invalidPath(c: TunnelContext): Response {
  return c.json(
    { error: { code: 'invalid_path', message: 'The panel tunnel only serves /panel/api paths' } },
    400
  )
}

function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}
