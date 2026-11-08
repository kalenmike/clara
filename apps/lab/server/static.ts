import { readFileSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import type { ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export const SECURITY_HEADERS: Record<string, string> = {
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

export interface StaticFiles {
  index: Buffer | undefined
  root: string
}

/**
 * The lab server runs from source through `pnpm clara lab` and from the bundle
 * through `pnpm build`. Vite always emits to `apps/lab/dist/web`, so the source
 * layout needs one more parent hop than the bundle layout.
 */
export function staticRootCandidates(moduleUrl: string | URL = import.meta.url): string[] {
  const directory = dirname(fileURLToPath(moduleUrl))
  return [
    resolve(directory, '..', 'web'), // dist/server/index.js -> dist/web
    resolve(directory, '..', 'dist', 'web'), // server/static.ts -> dist/web
  ]
}

export function loadStaticFiles(): StaticFiles {
  const candidates = staticRootCandidates()
  for (const root of candidates) {
    try {
      return { root, index: readFileSync(join(root, 'index.html')) }
    } catch {
      // Try the other layout.
    }
  }
  return { root: candidates[0], index: undefined }
}

function contentType(path: string): string | undefined {
  return CONTENT_TYPES[extname(path).toLowerCase()]
}

function resolveAsset(root: string, pathname: string): string | undefined {
  if (pathname.includes('\0')) return undefined
  const normalized = pathname.replace(/^\/+/, '')
  if (!normalized || normalized.split('/').includes('..')) return undefined
  const file = resolve(root, normalized)
  if (file !== root && !file.startsWith(`${root}${sep}`)) return undefined
  return file
}

export function serveStatic(
  response: ServerResponse,
  method: string,
  pathname: string,
  files: StaticFiles
): boolean {
  if (pathname === '/' || pathname === '/index.html') {
    if (!files.index) return false
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': files.index.length,
      'cache-control': 'no-store',
    })
    if (method !== 'HEAD') response.end(files.index)
    else response.end()
    return true
  }

  if (pathname !== '/favicon.svg' && !pathname.startsWith('/assets/')) return false
  const file = resolveAsset(files.root, pathname)
  const type = file ? contentType(file) : undefined
  if (!file || !type) return false

  try {
    const body = readFileSync(file)
    response.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    })
    if (method !== 'HEAD') response.end(body)
    else response.end()
    return true
  } catch {
    return false
  }
}
