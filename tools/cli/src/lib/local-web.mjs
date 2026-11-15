// Static server for the built web client in local mode.
//
// `clara start web --local` spawns this file so the local stack serves the
// same `apps/web/dist` output as the container, including the `/healthz`
// contract the status and rebuild probes expect.

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { root } from './router.mjs'
import { positiveInt } from './server-control.mjs'

const here = fileURLToPath(import.meta.url)
export const WEB_DIST = join(root, 'apps', 'web', 'dist')

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export function localWebPort(env = process.env) {
  return positiveInt(env.CLARA_WEB_PORT, 8080)
}

/** Resolve a URL path to a file under dist, with SPA fallback. */
export function distFile(pathname, dist = WEB_DIST) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const candidate = resolve(dist, relative)
  if (candidate !== dist && !candidate.startsWith(`${dist}${sep}`)) return undefined
  try {
    if (statSync(candidate).isFile()) return candidate
  } catch {
    // Fall through to the SPA entry or a 404 below.
  }
  if (extname(relative)) return undefined
  const index = join(dist, 'index.html')
  return existsSync(index) ? index : undefined
}

function contentType(path) {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

export function createLocalWebServer({ dist = WEB_DIST, env = process.env } = {}) {
  return createServer((request, response) => {
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' })
      response.end()
      return
    }

    let pathname
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    } catch {
      response.writeHead(400).end()
      return
    }

    if (pathname === '/healthz') {
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(
        JSON.stringify({ ok: true, service: 'clara-web', mode: 'local', pid: process.pid })
      )
      return
    }

    const file = distFile(pathname, dist)
    if (!file) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(method === 'HEAD' ? undefined : 'not found')
      return
    }

    const cache = file.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
    response.writeHead(200, {
      'content-type': contentType(file),
      'cache-control': cache,
      'content-length': statSync(file).size,
    })
    if (method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(file).pipe(response)
  })
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === here

if (invokedDirectly) {
  const port = localWebPort()
  const host = process.env.CLARA_WEB_HOST?.trim() || '127.0.0.1'
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    console.error(`error: the web client is not built at ${WEB_DIST}. Run \`pnpm build\` first.`)
    process.exit(1)
  }
  const server = createLocalWebServer()
  server.listen(port, host, () => {
    console.log(`[clara-web] listening on http://${host}:${port}`)
  })
  const shutdown = () => server.close(() => process.exit(0))
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
