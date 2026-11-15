import { createServer, type Server } from 'node:http'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' http: https: ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
  'x-content-type-options': 'nosniff',
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const REVALIDATE = ['/index.html', '/sw.js', '/push-sw.js', '/manifest.webmanifest', '/healthz']

export type StaticServerOptions = {
  root: string
  port: number
  host?: string
}

export type StaticServer = {
  url: string
  port: number
  close: () => Promise<void>
}

/**
 * Serve the built web client. It mirrors `apps/web/public/_headers` and the
 * container's nginx rules so the PWA behaves the same from `clara`.
 */
export async function startStaticServer(options: StaticServerOptions): Promise<StaticServer> {
  const root = realpathSync(options.root)
  const host = options.host ?? '127.0.0.1'
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname === '/healthz') {
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache, max-age=0, must-revalidate',
      })
      response.end(healthBody(root))
      return
    }

    const file = findFile(root, url.pathname)
    if (!file) {
      response.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }
    try {
      const body = readFileSync(file)
      const headers = {
        ...SECURITY_HEADERS,
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': cacheControl(url.pathname),
        'content-length': String(body.byteLength),
      }
      response.writeHead(200, headers)
      if (request.method === 'HEAD') response.end()
      else response.end(body)
    } catch {
      response.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
      response.end('could not read the asset')
    }
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(options.port, host, () => resolveListen())
  })

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port
  return {
    url: `http://${host}:${port}`,
    port,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose())
        // Do not let a browser keep-alive connection hold the stop open.
        server.closeAllConnections?.()
      }),
  }
}

/**
 * The web build writes the health response with the version and protocol of
 * the assets it shipped. An older build has no such file, so answer the base
 * contract instead of inventing values.
 */
function healthBody(root: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, 'healthz'), 'utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as { service?: unknown }).service === 'clara-web'
    ) {
      return JSON.stringify(parsed)
    }
  } catch {
    // fall through to the base contract
  }
  return JSON.stringify({ ok: true, service: 'clara-web' })
}

function findFile(root: string, pathname: string): string | undefined {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const candidate = resolve(root, `.${clean}`)
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return undefined
  if (isFile(candidate)) return candidate
  if (!extname(pathname)) {
    const shell = join(root, 'index.html')
    return isFile(shell) ? shell : undefined
  }
  return undefined
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function cacheControl(pathname: string): string {
  if (REVALIDATE.includes(pathname)) return 'no-cache, max-age=0, must-revalidate'
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  return 'no-cache, max-age=0, must-revalidate'
}
