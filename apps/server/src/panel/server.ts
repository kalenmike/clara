import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import type { Server } from 'node:http'
import { checkPanelRequest } from './security.ts'
import type { PanelDataSource } from './runtime.ts'

const API_PATH = '/panel/api/v1/status'
const ASSETS_PREFIX = '/assets/'

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-dns-prefetch-control': 'off',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

export type PanelServerOptions = {
  source: PanelDataSource
  port: number
  assetsDir?: string
  log?: (message: string, detail?: unknown) => void
}

export type PanelServer = {
  url: string
  port: number
  close: () => Promise<void>
}

export async function startPanelServer(options: PanelServerOptions): Promise<PanelServer> {
  const assetsRoot = resolveAssetsRoot(options.assetsDir)
  const indexHtml = readIndexHtml(assetsRoot)
  let port = options.port

  const server = createServer((request, response) => {
    void handleRequest(request, response, {
      source: options.source,
      port,
      assetsRoot,
      indexHtml,
      log: options.log,
    }).catch((cause) => {
      options.log?.('panel request failed', cause)
      if (!response.headersSent) {
        sendJson(response, request.method, 500, {
          error: { code: 'internal', message: 'The agent panel could not complete the request' },
        })
      } else {
        response.end()
      }
    })
  })

  await listen(server, options.port)
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('The panel server did not report a TCP address')
  }
  port = address.port

  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () => closeServer(server),
  }
}

type RequestContext = {
  source: PanelDataSource
  port: number
  assetsRoot: string | undefined
  indexHtml: Buffer | undefined
  log?: (message: string, detail?: unknown) => void
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext
): Promise<void> {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value)
  }

  const check = checkPanelRequest(request, context.port)
  if (!check.ok) {
    sendJson(response, request.method, check.status, {
      error: { code: 'forbidden', message: check.message },
    })
    return
  }

  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD')
    sendJson(response, method, 405, {
      error: { code: 'method_not_allowed', message: 'The agent panel is read-only' },
    })
    return
  }

  let pathname: string
  try {
    pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  } catch {
    sendJson(response, method, 400, {
      error: { code: 'bad_request', message: 'Invalid request path' },
    })
    return
  }

  if (pathname === API_PATH) {
    try {
      const snapshot = await context.source.snapshot()
      sendJson(response, method, 200, snapshot)
    } catch (cause) {
      context.log?.('could not build the panel snapshot', cause)
      sendJson(response, method, 500, {
        error: { code: 'snapshot_failed', message: 'Could not read the agent status' },
      })
    }
    return
  }

  if (pathname.startsWith('/panel/api/')) {
    sendJson(response, method, 404, {
      error: { code: 'not_found', message: 'Unknown panel endpoint' },
    })
    return
  }

  if (pathname === '/' || pathname === '/index.html') {
    if (!context.indexHtml) {
      sendText(
        response,
        method,
        503,
        'text/plain; charset=utf-8',
        'The Clara agent panel is not built. Run `pnpm build` in the repository, then restart the agent.\n'
      )
      return
    }
    sendBuffer(response, method, 200, 'text/html; charset=utf-8', context.indexHtml, 'no-store')
    return
  }

  const assetPath =
    pathname === '/favicon.svg'
      ? pathname
      : pathname.startsWith(ASSETS_PREFIX)
        ? pathname
        : undefined
  if (!assetPath) {
    sendJson(response, method, 404, {
      error: { code: 'not_found', message: 'Not found' },
    })
    return
  }

  const file = resolveAsset(context.assetsRoot, assetPath)
  const contentType = file ? CONTENT_TYPES[extname(file)] : undefined
  if (!file || !contentType) {
    sendJson(response, method, 404, {
      error: { code: 'not_found', message: 'Not found' },
    })
    return
  }

  try {
    const body = readFileSync(file)
    const cache = pathname.startsWith(ASSETS_PREFIX)
      ? 'public, max-age=31536000, immutable'
      : 'no-store'
    sendBuffer(response, method, 200, contentType, body, cache)
  } catch (cause) {
    context.log?.('could not read a panel asset', cause)
    sendJson(response, method, 500, {
      error: { code: 'asset_failed', message: 'Could not read the panel asset' },
    })
  }
}

function resolveAssetsRoot(assetsDir: string | undefined): string | undefined {
  if (!assetsDir) return undefined
  try {
    return realpathSync(assetsDir)
  } catch {
    return undefined
  }
}

function readIndexHtml(assetsRoot: string | undefined): Buffer | undefined {
  if (!assetsRoot) return undefined
  try {
    return readFileSync(join(assetsRoot, 'index.html'))
  } catch {
    return undefined
  }
}

function resolveAsset(assetsRoot: string | undefined, requestPath: string): string | undefined {
  if (!assetsRoot) return undefined

  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return undefined
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined
  if (decoded.split('/').some((segment) => segment === '..' || segment === '.')) return undefined

  try {
    const target = realpathSync(resolve(assetsRoot, `.${decoded}`))
    if (target !== assetsRoot && !target.startsWith(`${assetsRoot}${sep}`)) return undefined
    return statSync(target).isFile() ? target : undefined
  } catch {
    return undefined
  }
}

function sendJson(
  response: ServerResponse,
  method: string | undefined,
  status: number,
  body: unknown
): void {
  const text = JSON.stringify(body)
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('content-length', Buffer.byteLength(text))
  response.end(method === 'HEAD' ? undefined : text)
}

function sendText(
  response: ServerResponse,
  method: string | undefined,
  status: number,
  contentType: string,
  text: string
): void {
  sendBuffer(response, method, status, contentType, Buffer.from(text), 'no-store')
}

function sendBuffer(
  response: ServerResponse,
  method: string | undefined,
  status: number,
  contentType: string,
  body: Buffer,
  cacheControl: string
): void {
  response.statusCode = status
  response.setHeader('content-type', contentType)
  response.setHeader('cache-control', cacheControl)
  response.setHeader('content-length', body.byteLength)
  response.end(method === 'HEAD' ? undefined : body)
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const onError = (cause: Error) => {
      server.off('listening', onListening)
      reject(cause)
    }
    const onListening = () => {
      server.off('error', onError)
      resolvePromise()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => {
    server.close(() => resolvePromise())
    server.closeAllConnections()
  })
}
