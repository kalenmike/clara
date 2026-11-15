import type { Context, Hono } from 'hono'
import type { ApiDependencies, ApiVariables, LabEndpoint } from '../context.ts'

const TUNNEL_PREFIX = '/v1/lab'
const LAB_API_PREFIX = '/api'
const MAX_BODY_BYTES = 16 * 1024 * 1024

/** Only the lab API is reachable; nothing else on the lab host is tunneled. */
const FORWARD_HEADERS = ['accept', 'content-type', 'x-clara-lab', 'user-agent'] as const
const RESPONSE_HEADERS = ['content-type', 'cache-control', 'allow', 'retry-after'] as const

type TunnelContext = Context<{ Variables: ApiVariables }>

/**
 * Carries lab calls from the paired browser session to the lab service that
 * runs next to the engine. The lab keeps the engine token and workspace access;
 * the hub only forwards the API surface under `/api`.
 */
export function registerLabBridge(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  const handler = (c: TunnelContext) => forward(c, deps)
  app.all(TUNNEL_PREFIX, handler)
  app.all(`${TUNNEL_PREFIX}/*`, handler)
}

async function forward(c: TunnelContext, deps: ApiDependencies): Promise<Response> {
  const endpoint = deps.lab?.()
  if (!endpoint) return unavailable(c)

  const route = resolveRoute(c, endpoint)
  if (!route.ok) return route.response

  const payload = await readBody(c)
  if (!payload.ok) return payload.response

  let upstream: Response
  try {
    upstream = await fetch(route.target, {
      method: c.req.method,
      headers: forwardHeaders(c, endpoint, route.authority),
      ...(payload.body === undefined ? {} : { body: payload.body }),
      redirect: 'manual',
      signal: c.req.raw.signal,
    })
  } catch (cause) {
    deps.log('lab tunnel request failed', cause)
    return unavailable(c)
  }

  const headers = new Headers()
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  return new Response(c.req.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  })
}

type Route = { ok: true; target: URL; authority: string } | { ok: false; response: Response }

function resolveRoute(c: TunnelContext, endpoint: LabEndpoint): Route {
  const requestUrl = new URL(c.req.url)
  const rest = requestUrl.pathname.slice(TUNNEL_PREFIX.length)
  if (rest && !rest.startsWith('/')) return { ok: false, response: invalidPath(c) }

  let decoded: string
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    return { ok: false, response: invalidPath(c) }
  }
  if (decoded.includes('\\') || decoded.includes('\0')) {
    return { ok: false, response: invalidPath(c) }
  }
  if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) {
    return { ok: false, response: invalidPath(c) }
  }

  const base = endpoint.url.replace(/\/+$/, '')
  const target = new URL(`${base}${LAB_API_PREFIX}${decoded}`)
  target.search = requestUrl.search
  // Normalizing a hostile path must never leave the lab API surface.
  if (target.pathname !== LAB_API_PREFIX && !target.pathname.startsWith(`${LAB_API_PREFIX}/`)) {
    return { ok: false, response: invalidPath(c) }
  }
  return { ok: true, target, authority: target.host }
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

function forwardHeaders(c: TunnelContext, endpoint: LabEndpoint, authority: string): Headers {
  const headers = new Headers()
  for (const name of FORWARD_HEADERS) {
    const value = c.req.header(name)
    if (value !== undefined) headers.set(name, value)
  }
  // The lab's Origin guard expects its own origin, never the hub's. The bridge
  // token is the only credential the lab sees.
  headers.set('origin', `http://${authority}`)
  if (endpoint.token) headers.set('authorization', `Bearer ${endpoint.token}`)
  return headers
}

function unavailable(c: TunnelContext): Response {
  return c.json(
    {
      error: {
        code: 'lab_unavailable',
        message: 'The Clara Lab service is not reachable from the hub',
      },
    },
    503
  )
}

function invalidPath(c: TunnelContext): Response {
  return c.json(
    { error: { code: 'invalid_path', message: 'The lab tunnel only serves /api paths' } },
    400
  )
}
