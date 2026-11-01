import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

type LocalService = {
  url: string
  password?: string
  version?: string
}

const root = fileURLToPath(new URL('../..', import.meta.url))

const packageVersion = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

function git(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

const commit = git(['rev-parse', '--short', 'HEAD']) ?? null
const dirty = Boolean(git(['status', '--porcelain']))
const builtAt = new Date().toISOString()

const SERVICE_CACHE_MS = 1_000
let serviceCache: { at: number; value: LocalService | undefined } | null = null

/**
 * The background OpenCode service stores its URL and password in the XDG state
 * directory. Read it per request: a restarted service registers a new port and
 * password, and a proxy target captured at startup would keep pointing at the
 * dead one until Vite restarts.
 */
function readLocalService(): LocalService | undefined {
  const now = Date.now()
  if (serviceCache && now - serviceCache.at < SERVICE_CACHE_MS) return serviceCache.value

  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state')
  let value: LocalService | undefined
  try {
    const raw = readFileSync(join(stateHome, 'opencode', 'service.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LocalService>
    if (parsed.url) {
      value = { url: parsed.url, password: parsed.password, version: parsed.version }
    }
  } catch {
    value = undefined
  }

  serviceCache = { at: now, value }
  return value
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/** Forwards `/oc/*` to the current local service, including auth and SSE. */
function localServiceProxy(req: IncomingMessage, res: ServerResponse) {
  const service = readLocalService()
  if (!service) {
    sendJson(res, 503, { error: 'No local OpenCode service found. Start OpenCode and retry.' })
    return
  }

  let target: URL
  try {
    target = new URL(service.url)
  } catch {
    sendJson(res, 502, { error: `Invalid OpenCode service URL: ${service.url}` })
    return
  }

  const headers: IncomingHttpHeaders = {
    ...req.headers,
    host: target.host,
    // Server-sent events must not be buffered by an intermediate compressor.
    'accept-encoding': 'identity',
  }
  if (service.password) {
    const token = Buffer.from(`opencode:${service.password}`).toString('base64')
    headers.authorization = `Basic ${token}`
  } else {
    delete headers.authorization
  }

  const incomingPath = req.url && req.url.length > 0 ? req.url : '/'
  const prefix = target.pathname.replace(/\/$/, '')
  const path = `${prefix}${incomingPath.startsWith('/') ? incomingPath : `/${incomingPath}`}`

  const send = target.protocol === 'https:' ? httpsRequest : httpRequest
  const upstream = send(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method: req.method,
      path,
      headers,
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(res)
    }
  )

  upstream.on('error', (error) => {
    if (res.headersSent) {
      res.end()
      return
    }
    sendJson(res, 502, {
      error: `OpenCode service unreachable at ${service.url}. It may have restarted on a new port.`,
      detail: error.message,
    })
  })

  req.pipe(upstream)
}

function localServiceProxyPlugin(): Plugin {
  return {
    name: 'clara-local-service-proxy',
    configureServer(server) {
      server.middlewares.use('/oc', localServiceProxy)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/oc', localServiceProxy)
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    localServiceProxyPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Clara',
        short_name: 'Clara',
        description: 'A secure web client for OpenCode sessions.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      strategies: 'injectManifest',
      // The plugin locates the custom worker as `<srcDir>/<filename>`.
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // A classic worker keeps `importScripts` available and avoids module
        // service worker support gaps on iOS.
        rollupFormat: 'iife',
      },
    }),
  ],
  define: {
    'import.meta.env.CLARA_VERSION': JSON.stringify(packageVersion),
    'import.meta.env.CLARA_BUILD': JSON.stringify({
      mode: command === 'serve' ? 'dev' : 'build',
      commit,
      dirty,
      builtAt,
    }),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Docs are content only; editing them should not trigger a browser reload.
      ignored: ['**/docs/**'],
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
}))
